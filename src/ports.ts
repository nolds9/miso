// ---------------------------------------------------------------------------
// All domain types, port signatures, and closed vocabularies for the pipeline.
//
// LIVE DB facts (introspected 2026-06-04):
//   Database ID  : 90f96515-c3a3-4173-b317-35bff393082e  (== NOTION_DATABASE_ID)
//   Data Source  : 2dd1b4f7-bb93-4ecc-8a34-ee501fad3531  (== NOTION_DATA_SOURCE_ID)
//
//   Cuisine Type (multi_select):
//     Japanese | Indian | Korean | Mexican | French | Mediterranean |
//     Middle-Eastern | Chinese | Thai | Italian | Vietanamese | BBQ |
//     American | Seafood | Latin
//
//   Tags (multi_select):
//     Dessert | Dinner | Easy | InstaPot | Side | Sauce |
//     Holiday | Lunch | Appetizer
//
//   Category (select):
//     dinner | lunch | Appetizer   ← note inconsistent casing; normalise on write
// ---------------------------------------------------------------------------

import type { Result } from "./result.ts";

// ── Closed vocabularies ────────────────────────────────────────────────────

// Subset of live DB options the extractor may emit — maps 1-to-1 to DB values.
export const CUISINE_TYPES = [
  "Japanese", "Indian", "Korean", "Mexican", "French",
  "Mediterranean", "Middle-Eastern", "Chinese", "Thai", "Italian",
  "Vietanamese", "BBQ", "American", "Seafood", "Latin",
] as const;
export type CuisineType = (typeof CUISINE_TYPES)[number];

// Tags the extractor may propose; constrained to live DB options at write time.
export const TAGS = [
  "Dessert", "Dinner", "Easy", "InstaPot", "Side",
  "Sauce", "Holiday", "Lunch", "Appetizer",
] as const;
export type Tag = (typeof TAGS)[number];

// Category values — normalised to Title Case on write to absorb DB casing drift.
export const CATEGORY_VALUES = ["dinner", "lunch", "Appetizer"] as const;
export type CategoryValue = (typeof CATEGORY_VALUES)[number];

export type Effort   = "Quick" | "Weeknight" | "Project";
export type MealType = "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Dessert" | "Drink" | "Side" | "Sauce/Condiment";

// Provenance: which tier of enrichment produced the extraction.
export type ExtractionTier = "caption" | "caption+comment" | "multimodal";

// ── Source-shaped (mirrors saved_posts.json) ───────────────────────────────

export type DictItem = { readonly label: string; readonly value: string };
export type DictGroup = { readonly title: string; readonly dict: readonly DictItem[] };

export type LabelValue =
  | { readonly label: string; readonly value: string; readonly href?: string }
  | { readonly title: string; readonly dict: readonly DictGroup[] };

export type ExportEntry = {
  readonly timestamp: number;
  readonly media: readonly unknown[];
  readonly label_values: readonly LabelValue[];
  readonly fbid?: string;
};

// ── Normalised domain entity ───────────────────────────────────────────────

export type Reel = {
  readonly url: string;
  readonly reelId: string;           // parsed from URL — dedup key
  readonly creator: string;
  readonly handle: string;
  readonly savedAt: Date;
  readonly caption: string;          // mojibake-repaired
  readonly hashtags: readonly string[];
  readonly availableTier: ExtractionTier;
  readonly firstComment?: string;    // populated by enrichReel (stub)
  readonly transcript?: string;      // populated by enrichReel (stub)
  readonly onScreenText?: string;    // populated by enrichReel (stub)
};

// ── Recipe domain ──────────────────────────────────────────────────────────

export type Ingredient = {
  readonly quantity?: number;
  readonly unit?: string;
  readonly item: string;
  readonly notes?: string;
};

export type Nutrition = {
  readonly calories?: number;
  readonly proteinG?: number;
  readonly fatG?: number;
  readonly carbsG?: number;
};

export type Recipe = {
  readonly name: string;
  readonly summary: string;
  readonly cuisine: CuisineType;
  readonly mealType: MealType;
  readonly effort: Effort;
  readonly ingredients: readonly Ingredient[];
  readonly steps: readonly string[];
  readonly prepMinutes?: number;
  readonly cookMinutes?: number;
  readonly servings?: number;
  readonly nutrition?: Nutrition;
  readonly sourceTier: ExtractionTier;
  readonly confidence: number;       // 0–1, model self-rated completeness
};

// Gate result — discriminated union driving pipeline control flow.
export type Extraction =
  | { readonly kind: "recipe";    readonly recipe: Recipe }
  | { readonly kind: "partial";   readonly recipe: Recipe; readonly missing: readonly string[] }
  | { readonly kind: "no-recipe"; readonly reason: string };

// ── Notion sink shape ──────────────────────────────────────────────────────

export type NotionVocab = {
  readonly cuisineType: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
  readonly keywords: ReadonlySet<string>;
  readonly category: ReadonlySet<string>;
};

export type NotionRecipePage = {
  readonly databaseId: string;
  readonly properties: {
    readonly Name: string;
    readonly Tags: readonly string[];
    readonly URL: string;
    readonly "Cuisine Type": readonly string[];
    readonly "Cook Time": number | null;
    readonly "Prep Time": number | null;
    readonly Servings: string;
    readonly "Total Time": string;
    readonly Category?: string;
    readonly Description: string;
    readonly Notes: string;
    readonly Keywords: readonly string[];
  };
  readonly body: {
    readonly ingredients: readonly Ingredient[];
    readonly steps: readonly string[];
    readonly nutrition?: Nutrition;
  };
};

// ── Port signatures (effectful, swappable) ─────────────────────────────────

export type ReadExport         = (path: string)          => Promise<Result<readonly ExportEntry[]>>;
export type ExistingSourceUrls = ()                      => Promise<ReadonlySet<string>>;
export type ExtractRecipe      = (reel: Reel)            => Promise<Result<Extraction>>;
export type EnrichReel         = (reel: Reel, toTier: ExtractionTier) => Promise<Result<Reel>>;
export type WriteRecipe        = (page: NotionRecipePage) => Promise<Result<string>>;

// ── Pure transform signatures ──────────────────────────────────────────────

export type NormalizeReel = (entry: ExportEntry) => Reel;
export type ToNotionPage  = (databaseId: string, vocab: NotionVocab) => (reel: Reel, recipe: Recipe) => NotionRecipePage;

// ── Run report ─────────────────────────────────────────────────────────────

export type ReelOutcome =
  | {
      readonly kind: "written";
      readonly url: string;
      readonly name: string;
      readonly tier: ExtractionTier;
      readonly cuisine: CuisineType;
      readonly mealType: MealType;
    }
  | { readonly kind: "duplicate"; readonly url: string }
  | { readonly kind: "no-recipe"; readonly url: string; readonly reason: string }
  | { readonly kind: "partial";   readonly url: string; readonly missing: readonly string[] }
  | { readonly kind: "failed";    readonly url: string; readonly stage: string; readonly message: string };

export type RunReport = {
  readonly total: number;
  readonly written: number;
  readonly duplicate: number;
  readonly noRecipe: number;
  readonly partial: number;
  readonly failed: number;
  readonly cuisineTally: Record<string, number>;
  readonly mealTypeTally: Record<string, number>;
  readonly tierTally: Record<ExtractionTier, number>;
  readonly outcomes: readonly ReelOutcome[];
  readonly durationMs: number;
  readonly proposedNewValues: readonly string[];  // strict-mode misses → review queue
};
