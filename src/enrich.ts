// ---------------------------------------------------------------------------
// enrich.ts — re-export Tier-1 EnrichReel factory for run.ts
// ---------------------------------------------------------------------------

export { makeEnrichReel, loadEnrichConfig, enrichReelFromFactory } from "./enrich/index.ts";
export { EnrichError } from "./enrich/types.ts";
export type { EnrichConfig } from "./enrich/types.ts";
