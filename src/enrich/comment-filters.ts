// ---------------------------------------------------------------------------
// comment-filters.ts — reject reel audio credits and non-comment UI (pure)
// ---------------------------------------------------------------------------

/** Instagram reel audio row: "Artist • Song" / "Mix: … • … (Instrumental) | …" */
const AUDIO_LINE_RE =
  /^(Mix:|Original audio|·\s*Audio)/i;

/** Two-or-more " • " segments, little recipe signal — typical music attribution. */
const MULTI_BULLET_AUDIO_RE =
  /(^|[^\w])([^•\n]{2,50}\s•\s[^•\n]{2,50})(\s•\s|\s*\|)/;

const INSTRUMENTAL_RE = /\b(instrumental|official audio|audio\s+used)\b/i;

const REEL_UI_RE =
  /^(reply|view|more|follow|like|share|save|comments?|likes?|views?|\d+\s*(likes?|comments?|views?))$/i;

const RECIPE_SIGNAL_RE =
  /\b(ingredients?|instructions?|steps?|recipe|tbsp|tsp|cup|cups|oz|grams?|ml|preheat|bake|sauté|saute|\d+\s*(tbsp|tsp|cup|oz|lb|g|kg|ml))\b/i;

/** True when text is likely the reel's music strip, not a user comment. */
export const isAudioOrReelUiNoise = (text: string): boolean => {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 8) return true;
  if (REEL_UI_RE.test(t)) return true;
  if (AUDIO_LINE_RE.test(t)) return true;
  if (INSTRUMENTAL_RE.test(t)) return true;

  const bulletCount = (t.match(/\s•\s/g) ?? []).length;
  const tightBullet = t.includes("•") && !/\s•\s/.test(t);
  const pipeCount = (t.match(/\s\|\s/g) ?? []).length;
  if ((bulletCount >= 2 || (bulletCount >= 1 && pipeCount >= 1)) && !RECIPE_SIGNAL_RE.test(t)) {
    return true;
  }
  if (MULTI_BULLET_AUDIO_RE.test(t) && !RECIPE_SIGNAL_RE.test(t)) {
    return true;
  }

  // Short "Artist • Song" (spaced or tight bullet) without recipe signals
  if (!RECIPE_SIGNAL_RE.test(t) && t.length < 120) {
    const parts = t.split(/\s*•\s*/);
    if (parts.length === 2 && parts.every((p) => p.length < 70)) {
      return true;
    }
    if (tightBullet && parts.length === 2) return true;
  }

  return false;
};
