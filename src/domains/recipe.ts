// ---------------------------------------------------------------------------
// domains/recipe.ts — gate + extract DomainExtractor for recipes
//
// Tier-0: gemini-2.5-flash (cheap, caption-only)
// Tier-2: claude-sonnet-4  (escalation, richer context — stub for now)
//
// The heuristic pre-gate fires first so non-recipe reels never reach the model.
// ---------------------------------------------------------------------------

import type { Reel, Extraction, ExtractRecipe, CuisineType, MealType, Effort, Ingredient } from "../ports.ts";
import { CUISINE_TYPES } from "../ports.ts";
import { ok, err } from "../result.ts";

// ── Cheap heuristic pre-gate ───────────────────────────────────────────────
// Returns true when the caption / hashtags contain strong recipe signals.
// No model call — purely string matching.

const RECIPE_HASHTAGS = new Set([
  "recipe", "recipes", "cooking", "foodrecipe", "easyrecipe", "healthyrecipe",
  "quickrecipe", "dinnerrecipe", "lunchrecipe", "breakfastrecipe",
]);

const MEASUREMENT_RE = /\b\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml|clove|inch|cm)\b/i;
const RECIPE_HEADER_RE = /\b(ingredients?|steps?|instructions?|method|directions?)\b/i;

export const hasRecipeSignal = (reel: Reel): boolean => {
  const captionLower = reel.caption.toLowerCase();

  // Strong: explicit recipe header in caption
  if (RECIPE_HEADER_RE.test(captionLower)) return true;

  // Strong: measurement units (e.g. "2 tbsp butter")
  if (MEASUREMENT_RE.test(captionLower)) return true;

  // Moderate: any recipe-tagged hashtag
  if (reel.hashtags.some((h) => RECIPE_HASHTAGS.has(h.toLowerCase()))) return true;

  return false;
};

// ── Gemini tier-0 extractor ────────────────────────────────────────────────

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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
    "confidence": number (0.0–1.0, your completeness rating)
  }
}

If the caption mentions a recipe exists but lacks ingredients/steps (e.g. "comment RECIPE for the link"):
{
  "kind": "partial",
  "recipe": { ...same shape, fill what you can... },
  "missing": ["ingredients", "steps"]  (list what's absent)
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

const callGemini = async (
  caption: string,
  hashtags: readonly string[],
  apiKey: string,
): Promise<Extraction> => {
  const userContent = `Caption:\n${caption}\n\nHashtags: ${hashtags.map((h) => `#${h}`).join(" ")}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  const resp = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed: unknown = JSON.parse(text);
  return parsed as Extraction;
};

// ── Claude tier-2 escalation ───────────────────────────────────────────────
// Called only when the reel is gated as recipe-but-partial after enrichment.
// Stub: just re-runs the Gemini model since EnrichReel is a no-op anyway.

const callClaude = async (
  caption: string,
  hashtags: readonly string[],
  extraContext: string,
  apiKey: string,
): Promise<Extraction> => {
  const userContent = [
    `Caption:\n${caption}`,
    `Hashtags: ${hashtags.map((h) => `#${h}`).join(" ")}`,
    extraContext ? `Additional context:\n${extraContext}` : "",
  ].filter(Boolean).join("\n\n");

  const body = {
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    content?: { type: string; text?: string }[];
  };

  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  // Strip markdown fences if Claude wraps despite the instruction
  const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const parsed: unknown = JSON.parse(clean);
  return parsed as Extraction;
};

// ── Public ExtractRecipe port ──────────────────────────────────────────────

export const makeExtractRecipe = (config: {
  geminiApiKey: string;
  anthropicApiKey: string;
  escalationCap: number;
}): ExtractRecipe => async (reel: Reel) => {
  // Step 1: heuristic pre-gate (free, no model call)
  if (!hasRecipeSignal(reel)) {
    return ok({ kind: "no-recipe", reason: "No recipe signal in caption or hashtags" });
  }

  // Step 2: tier-0 Gemini extraction
  try {
    const extraction = await callGemini(reel.caption, reel.hashtags, config.geminiApiKey);

    // If partial and we have enriched context, try Claude (escalation)
    // EnrichReel is a no-op stub for now, so this path is never triggered in practice.
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
        const escalated = await callClaude(
          reel.caption,
          reel.hashtags,
          extraContext,
          config.anthropicApiKey,
        );
        return ok(escalated);
      } catch {
        // Escalation failed → return the partial result from tier-0
        return ok(extraction);
      }
    }

    return ok(extraction);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
