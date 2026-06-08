// ---------------------------------------------------------------------------
// comment-quality.ts — decide if fetched comment text is worth keeping (pure)
// ---------------------------------------------------------------------------

import { isAudioOrReelUiNoise } from "./comment-filters.ts";
import type { CommentSource } from "./types.ts";

const RECIPE_SIGNAL_RE =
  /\b(ingredients?|instructions?|steps?|recipe|tbsp|tsp|cup|cups|oz|grams?|ml|preheat|bake|\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml))\b/i;

/** True when scraped text is plausibly a recipe comment, not audio/UI/link-only. */
export const isUsefulRecipeComment = (
  text: string,
  source?: CommentSource,
): boolean => {
  const t = text.trim();
  if (t.length < 10 || isAudioOrReelUiNoise(t)) return false;

  if (RECIPE_SIGNAL_RE.test(t)) return true;

  // Owner/pinned short replies often link out — still not useful for Tier 1
  if (source === "pinned" || source === "owner") {
    return t.length >= 80 && !/^https?:\/\/\S+$/i.test(t);
  }

  return t.length >= 100;
};
