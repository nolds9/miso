// ---------------------------------------------------------------------------
// config.ts — all tunable values in one place (no magic numbers elsewhere)
// ---------------------------------------------------------------------------

export type Config = {
  // Paths
  readonly exportPath: string;

  // Notion IDs (confirmed live 2026-06-04)
  readonly notionDatabaseId: string;
  readonly notionDataSourceId: string;

  // LLM — single Nous Portal key covers both tiers
  readonly nousApiKey: string;

  // Concurrency
  readonly concurrencyExtract: number;  // tier-0 extract + Notion write pool
  readonly concurrencyWrite: number;    // Notion write ceiling (~3 req/s)

  // Escalation
  readonly escalationCap: number;       // max enrichReel climbs per reel

  // Run behaviour
  readonly dryRun: boolean;             // skip Notion writes when true
  readonly censusOnly: boolean;         // stop after classify (no write)
};

const int = (val: string | undefined, fallback: number): number => {
  const n = parseInt(val ?? "", 10);
  return isNaN(n) ? fallback : n;
};

const bool = (val: string | undefined, fallback: boolean): boolean => {
  if (val === undefined) return fallback;
  return val.toLowerCase() === "true" || val === "1";
};

export const loadConfig = (overrides: Partial<Config> = {}): Config => ({
  exportPath        : overrides.exportPath        ?? "saved_posts.json",
  notionDatabaseId  : overrides.notionDatabaseId  ?? process.env["NOTION_DATABASE_ID"]   ?? process.env["NOTION_PARENT_PAGE_ID"] ?? "",
  notionDataSourceId: overrides.notionDataSourceId ?? process.env["NOTION_DATA_SOURCE_ID"] ?? "",
  nousApiKey        : overrides.nousApiKey        ?? process.env["NOUS_API_KEY"]            ?? "",
  concurrencyExtract: overrides.concurrencyExtract ?? int(process.env["CONCURRENCY_EXTRACT"], 4),
  concurrencyWrite  : overrides.concurrencyWrite  ?? int(process.env["CONCURRENCY_WRITE"],   3),
  escalationCap     : overrides.escalationCap     ?? int(process.env["ESCALATION_CAP"],      1),
  dryRun            : overrides.dryRun            ?? bool(process.env["DRY_RUN"],             false),
  censusOnly        : overrides.censusOnly        ?? bool(process.env["CENSUS_ONLY"],         false),
});
