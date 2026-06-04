// ---------------------------------------------------------------------------
// enrich.ts — EnrichReel port implementation
//
// Currently a no-op stub. The port signature is satisfied so the pipeline
// compiles and runs; the escalation ladder (comment fetch, yt-dlp + Whisper)
// can be wired in here when needed.
//
// To implement (see docs/tier1-playwright-enrichment.md):
//   "caption+comment" → fetch the first/pinned comment from the reel URL
//   "multimodal"      → yt-dlp audio + Whisper transcript + frame OCR
// ---------------------------------------------------------------------------

import type { EnrichReel } from "./ports.ts";
import { ok } from "./result.ts";

export const enrichReel: EnrichReel = async (reel, _toTier) => {
  // Stub: return the reel unchanged.
  // The pipeline treats EnrichReel failures gracefully — it keeps the partial
  // result and logs it — so this is always safe to upgrade incrementally.
  return ok(reel);
};
