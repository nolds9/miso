// ---------------------------------------------------------------------------
// skip-enrich.ts — skip Tier-1 when the recipe lives off-platform (pure)
// ---------------------------------------------------------------------------

import type { Reel } from "../ports.ts";

const MEASUREMENT_RE = /\b\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml|clove)\b/i;
const RECIPE_HEADER_RE = /\b(ingredients?|steps?|instructions?|method|directions?)\b/i;
const COMMENT_RECIPE_RE = /\bcomment\b[^\n]{0,40}\brecipe\b/i;
const LINK_IN_BIO_RE = /\blink\s+in\s+bio\b/i;
const OFF_PLATFORM_RE =
  /\b(visit|linktr\.ee|bio\.site|\.com\/|\.net\/|\.org\/|get the recipe)\b/i;

const hasInlineRecipe = (caption: string): boolean =>
  RECIPE_HEADER_RE.test(caption) || MEASUREMENT_RE.test(caption);

/** Caption points off Instagram and has no ingredients/steps in export text. */
export const isExternalRecipeOnly = (reel: Reel): boolean => {
  const caption = reel.caption;
  if (!caption.trim()) return false;
  if (hasInlineRecipe(caption)) return false;

  const teaser =
    COMMENT_RECIPE_RE.test(caption) ||
    LINK_IN_BIO_RE.test(caption) ||
    OFF_PLATFORM_RE.test(caption);

  return teaser && OFF_PLATFORM_RE.test(caption);
};

export const skipEnrichReason = (reel: Reel): string =>
  isExternalRecipeOnly(reel)
    ? "external_link — recipe not in caption/comments on IG"
    : "enrich_skipped";

export const shouldSkipCommentEnrich = (reel: Reel): boolean =>
  isExternalRecipeOnly(reel);
