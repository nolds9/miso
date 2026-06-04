// ---------------------------------------------------------------------------
// notion.ts — schema introspection, seen-URL ledger, and recipe writer
//
// Uses @notionhq/client (SDK) rather than ntn CLI so we can write block
// children (ingredient to-do list + numbered steps) in a single pass.
//
// LIVE DB IDs (confirmed 2026-06-04):
//   NOTION_DATABASE_ID    = 90f96515-c3a3-4173-b317-35bff393082e
//   NOTION_DATA_SOURCE_ID = 2dd1b4f7-bb93-4ecc-8a34-ee501fad3531
// ---------------------------------------------------------------------------

import { Client, isFullPage } from "@notionhq/client";
import type {
  NotionRecipePage,
  NotionVocab,
  WriteRecipe,
  ExistingSourceUrls,
} from "./ports.ts";
import { ok, err } from "./result.ts";

// ── Client factory ─────────────────────────────────────────────────────────

export const makeNotionClient = (): Client =>
  new Client({ auth: process.env["NOTION_API_TOKEN"] ?? "" });

// ── Vocabulary introspection ───────────────────────────────────────────────
// Reads the live select/multi-select options from the data source so the
// extractor is always constrained to values the DB will actually accept.

export const introspectVocab = async (
  client: Client,
  dataSourceId: string,
): Promise<NotionVocab> => {
  // Use direct fetch to avoid untyped SDK internal request<T> calls
  const resp = await fetch(
    `https://api.notion.com/v1/data_sources/${dataSourceId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env["NOTION_API_TOKEN"] ?? ""}`,
        "Notion-Version": "2025-09-03",
      },
    },
  );
  const ds = (await resp.json()) as Record<string, unknown>;
  if (!resp.ok || ds["object"] === "error") {
    const msg =
      typeof ds["message"] === "string"
        ? ds["message"]
        : `Notion data source request failed (${resp.status})`;
    throw new Error(`introspectVocab: ${msg}`);
  }

  const props = (ds["properties"] ?? {}) as Record<
    string,
    { type: string; select?: { options: { name: string }[] }; multi_select?: { options: { name: string }[] } }
  >;

  const getOptions = (name: string): ReadonlySet<string> => {
    const p = props[name];
    if (!p) return new Set();
    const opts =
      p.type === "select"       ? (p.select?.options       ?? []) :
      p.type === "multi_select" ? (p.multi_select?.options ?? []) : [];
    return new Set(opts.map((o) => o.name));
  };

  return {
    cuisineType : getOptions("Cuisine Type"),
    tags        : getOptions("Tags"),
    keywords    : getOptions("Keywords"),
    category    : getOptions("Category"),
  };
};

// ── Strict-mode constraint helper ──────────────────────────────────────────
// Returns only values that exist in the vocab set.
// Rejected values are pushed into proposedNew (review queue).

export const constrain = (
  values: readonly string[],
  vocab: ReadonlySet<string>,
  proposedNew: string[],
): readonly string[] => {
  const accepted: string[] = [];
  for (const v of values) {
    if (vocab.has(v)) {
      accepted.push(v);
    } else {
      proposedNew.push(v);
    }
  }
  return accepted;
};

// ── Pure page mapper ───────────────────────────────────────────────────────

import type { Reel, Recipe } from "./ports.ts";

export const toNotionPage = (
  databaseId: string,
  vocab: NotionVocab,
  proposedNew: string[],
) => (reel: Reel, recipe: Recipe): NotionRecipePage => {
  const total = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  // Map effort/mealType → Tags (they have no dedicated columns in this DB)
  const effortTag = recipe.effort === "Quick"     ? "Easy"    :
                    recipe.effort === "Weeknight" ? undefined :
                    undefined;
  const mealTag   = recipe.mealType === "Dinner"  ? "Dinner"  :
                    recipe.mealType === "Lunch"    ? "Lunch"   :
                    recipe.mealType === "Dessert"  ? "Dessert" :
                    recipe.mealType === "Side"     ? "Side"    :
                    recipe.mealType === "Sauce/Condiment" ? "Sauce" :
                    recipe.mealType === "Snack"    ? "Appetizer" :
                    undefined;
  const rawTags = [effortTag, mealTag].filter((t): t is string => t !== undefined);

  return {
    databaseId,
    properties: {
      Name           : recipe.name,
      Tags           : constrain(rawTags, vocab.tags, proposedNew),
      URL            : reel.url,
      "Cuisine Type" : constrain([recipe.cuisine], vocab.cuisineType, proposedNew),
      "Cook Time"    : recipe.cookMinutes ?? null,
      "Prep Time"    : recipe.prepMinutes ?? null,
      Servings       : recipe.servings != null ? String(recipe.servings) : "",
      "Total Time"   : total > 0 ? String(total) : "",
      Description    : recipe.summary,
      Notes          : `${recipe.sourceTier} · conf ${recipe.confidence.toFixed(2)}`,
      Keywords       : constrain(reel.hashtags, vocab.keywords, proposedNew),
    },
    body: {
      ingredients : recipe.ingredients,
      steps       : recipe.steps,
      ...(recipe.nutrition !== undefined ? { nutrition: recipe.nutrition } : {}),
    },
  };
};

// ── Seen-URL ledger ────────────────────────────────────────────────────────
// Paginates the data source query to collect all existing reel IDs.
// Primary key: reel shortcode parsed from the URL column.
// Every pipeline-written row has a URL, so this is safe.

import { parseReelId } from "./transforms.ts";

export const makeExistingSourceUrls = (
  client: Client,
  dataSourceId: string,
): ExistingSourceUrls => async () => {
  const seen = new Set<string>();
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filter_properties: ["URL"],
      ...(cursor ? { start_cursor: cursor } : {}),
    };

    const resp = await fetch(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["NOTION_API_TOKEN"] ?? ""}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = (await resp.json()) as {
      object?: string;
      message?: string;
      results?: { properties?: { URL?: { url?: string | null } } }[];
      next_cursor: string | null;
      has_more: boolean;
    };

    if (!resp.ok || data.object === "error") {
      throw new Error(
        data.message ?? `Notion data source query failed (${resp.status})`,
      );
    }
    if (!Array.isArray(data.results)) {
      throw new Error("Notion data source query returned no results array");
    }

    for (const row of data.results) {
      const url = row.properties?.["URL"]?.url;
      if (url) {
        seen.add(parseReelId(url));
        seen.add(url);
      }
    }

    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return seen;
};

// ── Recipe writer ──────────────────────────────────────────────────────────
// Writes the page properties then appends ingredient + step blocks.
// Uses the Notion SDK to handle the block-level body in a single call.

import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import type { Ingredient, Nutrition } from "./ports.ts";

const ingredientBlock = (ing: Ingredient): BlockObjectRequest => {
  const parts = [
    ing.quantity != null ? String(ing.quantity) : undefined,
    ing.unit,
    ing.item,
    ing.notes ? `(${ing.notes})` : undefined,
  ].filter(Boolean);

  return {
    object: "block",
    type: "to_do",
    to_do: {
      rich_text: [{ type: "text", text: { content: parts.join(" ") } }],
      checked: false,
    },
  };
};

const stepBlock = (step: string, _i: number): BlockObjectRequest => ({
  object: "block",
  type: "numbered_list_item",
  numbered_list_item: {
    rich_text: [{ type: "text", text: { content: step } }],
  },
});

const nutritionBlock = (n: Nutrition): BlockObjectRequest => {
  const lines = [
    n.calories  != null ? `Calories: ${n.calories} kcal`   : null,
    n.proteinG  != null ? `Protein: ${n.proteinG}g`         : null,
    n.fatG      != null ? `Fat: ${n.fatG}g`                 : null,
    n.carbsG    != null ? `Carbs: ${n.carbsG}g`             : null,
  ].filter((l): l is string => l !== null);

  return {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "🥗" },
      rich_text: [{ type: "text", text: { content: lines.join(" · ") } }],
    },
  };
};

export const makeWriteRecipe = (
  client: Client,
  retryDelayMs = 350,
): WriteRecipe => async (page) => {
  const attemptCreate = async () => {
    const response = await client.pages.create({
      parent: { database_id: page.databaseId },
      properties: {
        Name: {
          title: [{ text: { content: page.properties.Name } }],
        },
        Tags: {
          multi_select: page.properties.Tags.map((t) => ({ name: t })),
        },
        URL: { url: page.properties.URL },
        "Cuisine Type": {
          multi_select: page.properties["Cuisine Type"].map((c) => ({ name: c })),
        },
        ...(page.properties["Cook Time"] != null
          ? { "Cook Time": { number: page.properties["Cook Time"] } }
          : {}),
        ...(page.properties["Prep Time"] != null
          ? { "Prep Time": { number: page.properties["Prep Time"] } }
          : {}),
        Servings:    { rich_text: [{ text: { content: page.properties.Servings } }] },
        "Total Time":{ rich_text: [{ text: { content: page.properties["Total Time"] } }] },
        Description: { rich_text: [{ text: { content: page.properties.Description } }] },
        Notes:       { rich_text: [{ text: { content: page.properties.Notes } }] },
        Keywords: {
          multi_select: page.properties.Keywords.map((k) => ({ name: k })),
        },
      },
    });
    return response.id;
  };

  try {
    let pageId: string;
    try {
      pageId = await attemptCreate();
    } catch (e: unknown) {
      // Notion 429: back off and retry once
      if (
        e != null &&
        typeof e === "object" &&
        "status" in e &&
        (e as { status: number }).status === 429
      ) {
        await new Promise((r) => setTimeout(r, retryDelayMs * 3));
        pageId = await attemptCreate();
      } else {
        throw e;
      }
    }

    // Append body blocks (ingredients → to-do, steps → numbered, nutrition → callout)
    const blocks: BlockObjectRequest[] = [
      ...(page.body.ingredients.length > 0
        ? [
            {
              object: "block" as const,
              type: "heading_3" as const,
              heading_3: {
                rich_text: [{ type: "text" as const, text: { content: "Ingredients" } }],
              },
            },
            ...page.body.ingredients.map(ingredientBlock),
          ]
        : []),
      ...(page.body.steps.length > 0
        ? [
            {
              object: "block" as const,
              type: "heading_3" as const,
              heading_3: {
                rich_text: [{ type: "text" as const, text: { content: "Steps" } }],
              },
            },
            ...page.body.steps.map(stepBlock),
          ]
        : []),
      ...(page.body.nutrition != null ? [nutritionBlock(page.body.nutrition)] : []),
    ];

    if (blocks.length > 0) {
      await client.blocks.children.append({
        block_id: pageId,
        children: blocks,
      });
    }

    return ok(pageId);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
