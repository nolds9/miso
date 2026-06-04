// ---------------------------------------------------------------------------
// domains/recipe.ts — gate + extract DomainExtractor for recipes
//
// Both tiers run through Nous Portal's OpenAI-compatible endpoint:
//   https://inference-api.nousresearch.com/v1/chat/completions
//
// Tier-0: google/gemini-3-flash-preview  (cheap, caption-only)
// Tier-2: anthropic/claude-sonnet-4.6    (escalation, richer context — stub)
//
// Auth: NOUS_API_KEY in .env (get from portal.nousresearch.com)
// The heuristic pre-gate fires first so non-recipe reels never reach the model.
// ---------------------------------------------------------------------------

import type { Reel, Extraction, ExtractRecipe } from "../ports.ts";
import { CUISINE_TYPES } from "../ports.ts";
import { ok, err } from "../result.ts";

// ── Model slugs ────────────────────────────────────────────────────────────

const TIER0_MODEL    = "google/gemini-3-flash-preview";   // fast + cheap
const TIER2_MODEL    = "anthropic/claude-sonnet-4.6";     // escalation
const NOUS_BASE_URL  = "https://inference-api.nousresearch.com/v1";

// ── Cheap heuristic pre-gate ───────────────────────────────────────────────
// Returns true when the caption / hashtags contain strong recipe signals.
// No model call — purely string matching.

const RECIPE_HASHTAGS = new Set([
  "recipe", "recipes", "cooking", "foodrecipe", "easyrecipe", "healthyrecipe",
  "quickrecipe", "dinnerrecipe", "lunchrecipe", "breakfastrecipe",
]);

const MEASUREMENT_RE   = /\b\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml|clove|inch|cm)\b/i;
const RECIPE_HEADER_RE = /\b(ingredients?|steps?|instructions?|method|directions?)\b/i;

export const hasRecipeSignal = (reel: Reel): boolean => {
  const captionLower = reel.caption.toLowerCase();
  if (RECIPE_HEADER_RE.test(captionLower)) return true;
  if (MEASUREMENT_RE.test(captionLower))   return true;
  if (reel.hashtags.some((h) => RECIPE_HASHTAGS.has(h.toLowerCase()))) return true;
  return false;
};

// ── Shared system prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recipe extraction assistant. Analyze the Instagram reel caption and hashtags provided and determine if it contains a recipe.

Return a JSON object (no markdown, no code fences) with this exact shape:

If it IS a recipe:
{
  "kind": "recipe",
  "recipe": {
    "name": string,
    "summary": string (1-2 sentences),
    "cuisine": one of [${CUISINE_TYPES.map((c) => `"${c}"`).join(", ")}],
    "mealType": one of ["Breakfast","Lunch","Dinner","Snack","Dessert","Drink","Side","Sauce/Condiment"],
    "effort": one of ["Quick","Weeknight","Project"],
    "ingredients": [{ "quantity": number|null, "unit": string|null, "item": string, "notes": string|null }],
    "steps": [string],
    "prepMinutes": number|null,
    "cookMinutes": number|null,
    "servings": number|null,
    "nutrition": { "calories": number|null, "proteinG": number|null, "fatG": number|null, "carbsG": number|null } | null,
    "sourceTier": "caption",
    "confidence": number (0.0-1.0, your completeness rating)
  }
}

If the caption mentions a recipe exists but lacks ingredients/steps (e.g. "comment RECIPE for the link"):
{
  "kind": "partial",
  "recipe": { ...same shape, fill what you can... },
  "missing": ["ingredients", "steps"]
}

If it is NOT a recipe (restaurant review, travel, workout, etc.):
{
  "kind": "no-recipe",
  "reason": string (brief explanation)
}

Rules:
- Pick the CLOSEST cuisine from the allowed list; never invent a new value.
- confidence 1.0 = all fields populated from explicit text; 0.6 = guessed from context; 0.0 = no usable content.
- Do NOT wrap the JSON in markdown fences.`;

// ── Shared OpenAI-compatible caller (Nous Portal endpoint) ─────────────────

const callNous = async (
  model: string,
  caption: string,
  hashtags: readonly string[],
  extraContext: string,
  apiKey: string,
): Promise<Extraction> => {
  const userParts = [
    `Caption:\n${caption}`,
    `Hashtags: ${hashtags.map((h) => `#${h}`).join(" ")}`,
    ...(extraContext ? [`Additional context:\n${extraContext}`] : []),
  ];

  const body = {
    model,
    temperature: 0.1,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system",  content: SYSTEM_PROMPT },
      { role: "user",    content: userParts.join("\n\n") },
    ],
  };

  const resp = await fetch(`${NOUS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Nous API error ${resp.status} (${model}): ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const raw = data.choices?.[0]?.message?.content ?? "";
  // Strip markdown fences defensively (some models add them despite json_object)
  const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(clean) as Extraction;
};

// ── Public ExtractRecipe port ──────────────────────────────────────────────

export const makeExtractRecipe = (config: {
  nousApiKey: string;
  escalationCap: number;
}): ExtractRecipe => async (reel: Reel) => {
  // Step 1: heuristic pre-gate (free, no model call)
  if (!hasRecipeSignal(reel)) {
    return ok({ kind: "no-recipe", reason: "No recipe signal in caption or hashtags" });
  }

  // Step 2: tier-0 extraction via Gemini Flash on Nous Portal
  try {
    const extraction = await callNous(
      TIER0_MODEL,
      reel.caption,
      reel.hashtags,
      "",
      config.nousApiKey,
    );

    // Step 3: if partial + enriched context available, escalate to Claude Sonnet
    // EnrichReel is a no-op stub for now so this path never fires in practice.
    if (
      extraction.kind === "partial" &&
      config.escalationCap > 0 &&
      (reel.firstComment ?? reel.transcript ?? reel.onScreenText)
    ) {
      const extraContext = [
        reel.firstComment ? `First comment: ${reel.firstComment}` : "",
        reel.transcript   ? `Transcript: ${reel.transcript}`       : "",
        reel.onScreenText ? `On-screen text: ${reel.onScreenText}` : "",
      ].filter(Boolean).join("\n");

      try {
        const escalated = await callNous(
          TIER2_MODEL,
          reel.caption,
          reel.hashtags,
          extraContext,
          config.nousApiKey,
        );
        return ok(escalated);
      } catch {
        // Escalation failed — return the partial result from tier-0
        return ok(extraction);
      }
    }

    return ok(extraction);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};



