// ---------------------------------------------------------------------------
// pick-comment.ts — choose the best comment candidate (pure, testable)
// ---------------------------------------------------------------------------

import type { CommentCandidate } from "./types.ts";
import { isAudioOrReelUiNoise } from "./comment-filters.ts";

const RECIPE_KEYWORDS_RE =
  /\b(ingredients?|instructions?|steps?|recipe|tbsp|tsp|cup|cups|oz|grams?|ml|preheat|bake|sauté|saute)\b/i;
const MEASUREMENT_RE = /\b\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml)\b/i;
const MIN_LENGTH = 40;

const recipeScore = (text: string): number => {
  let score = 0;
  if (MEASUREMENT_RE.test(text)) score += 3;
  if (RECIPE_KEYWORDS_RE.test(text)) score += 2;
  if (text.length >= 120) score += 1;
  if (/https?:\/\//i.test(text)) score += 1;
  return score;
};

const isUsableLength = (text: string): boolean =>
  text.length >= MIN_LENGTH || RECIPE_KEYWORDS_RE.test(text) || MEASUREMENT_RE.test(text);

/** Pick the best comment from DOM-extracted candidates. */
export const pickBestComment = (
  candidates: readonly CommentCandidate[] | null | undefined,
  ownerHandle: string,
): CommentCandidate | null => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const handle = ownerHandle.replace(/^@/, "").toLowerCase();
  const usable = candidates
    .map((c) => ({ ...c, text: c.text.trim() }))
    .filter(
      (c) =>
        c.text.length > 0 &&
        !isAudioOrReelUiNoise(c.text) &&
        isUsableLength(c.text),
    );

  if (usable.length === 0) return null;

  const scored = usable.map((c) => {
    let score = recipeScore(c.text);
    if (c.isPinned || c.source === "pinned") score += 8;
    if (c.source === "owner") score += 6;
    if (handle && c.author?.replace(/^@/, "").toLowerCase() === handle) score += 6;
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.c ?? null;
};
