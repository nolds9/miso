// ---------------------------------------------------------------------------
// run.ts — CLI entrypoint
//
// Usage:
//   pnpm run          # full pipeline (extract + write to Notion)
//   pnpm run --dry    # dry run (extract only, no Notion writes)
//   pnpm census       # classify only — report domain distribution, no writes
//
// dotenv/config MUST be imported first (before any port imports).
// ---------------------------------------------------------------------------

import "dotenv/config";

import { loadConfig } from "./config.ts";
import { readExport } from "./transforms.ts";
import {
  makeNotionClient,
  introspectVocab,
  makeExistingSourceUrls,
  makeWriteRecipe,
} from "./notion.ts";
import { makeExtractRecipe } from "./domains/recipe.ts";
import { enrichReel } from "./enrich.ts";
import { runPipeline } from "./pipeline.ts";
import type { RunReport, ReelOutcome } from "./ports.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

const parseArgs = (argv: string[]): { dryRun: boolean; censusOnly: boolean } => ({
  dryRun     : argv.includes("--dry") || argv.includes("--dry-run"),
  censusOnly : argv.includes("--census"),
});

const renderReport = (report: RunReport, dryRun: boolean): string => {
  const lines: string[] = [];
  const hr = "─".repeat(52);

  lines.push("");
  lines.push("  Miso — Recipe Extraction Report");
  lines.push(`  ${hr}`);
  lines.push(`  Total reels in export  : ${report.total}`);
  lines.push(`  Already in Notion      : ${report.duplicate}`);
  lines.push(`  No recipe detected     : ${report.noRecipe}`);
  lines.push(`  Partial (incomplete)   : ${report.partial}`);
  lines.push(`  Failed                 : ${report.failed}`);
  if (dryRun) {
    lines.push(`  Would write (dry run)  : ${report.written}`);
  } else {
    lines.push(`  Written to Notion      : ${report.written}`);
  }
  lines.push(`  Duration               : ${(report.durationMs / 1000).toFixed(1)}s`);

  if (report.written > 0) {
    lines.push("");
    lines.push("  Extraction tiers:");
    for (const [tier, count] of Object.entries(report.tierTally)) {
      if (count > 0) lines.push(`    ${tier.padEnd(20)} ${count}`);
    }
  }

  if (report.proposedNewValues.length > 0) {
    lines.push("");
    lines.push("  ⚠  Proposed new vocab values (review queue — NOT written to DB):");
    for (const v of report.proposedNewValues) {
      lines.push(`    • ${v}`);
    }
  }

  const failures = report.outcomes.filter(
    (o): o is Extract<ReelOutcome, { kind: "failed" }> => o.kind === "failed",
  );
  if (failures.length > 0) {
    lines.push("");
    lines.push("  Failures:");
    for (const f of failures) {
      lines.push(`    [${f.stage}] ${f.url}`);
      lines.push(`           ${f.message}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

// ── main ───────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const config = loadConfig({
    dryRun     : args.dryRun,
    censusOnly : args.censusOnly,
  });

  // Validate required config
  const missing: string[] = [];
  if (!config.notionDatabaseId)  missing.push("NOTION_DATABASE_ID / NOTION_PARENT_PAGE_ID");
  if (!config.notionDataSourceId) missing.push("NOTION_DATA_SOURCE_ID");
  if (!config.nousApiKey)           missing.push("NOUS_API_KEY");
  if (missing.length > 0) {
    console.error("Missing required env vars:");
    for (const m of missing) console.error(`  • ${m}`);
    process.exit(1);
  }

  console.log("Miso: Instagram Saved Reels → Notion Recipe Extractor");
  console.log(`Mode: ${config.censusOnly ? "census" : config.dryRun ? "dry run" : "full"}`);
  console.log(`Export: ${config.exportPath}`);
  console.log("Introspecting Notion vocab…");

  const notion = makeNotionClient();
  const vocab  = await introspectVocab(notion, config.notionDataSourceId);

  console.log(`  Cuisine options : ${[...vocab.cuisineType].join(", ")}`);
  console.log(`  Tag options     : ${[...vocab.tags].join(", ")}`);
  console.log("Running pipeline…\n");

  const report = await runPipeline({
    readExport,
    existingSourceUrls : makeExistingSourceUrls(notion, config.notionDataSourceId),
    extractRecipe      : makeExtractRecipe({
      nousApiKey       : config.nousApiKey,
      escalationCap    : config.escalationCap,
    }),
    enrichReel,
    writeRecipe        : makeWriteRecipe(notion),
    vocab,
    databaseId         : config.notionDatabaseId,
    concurrencyExtract : config.concurrencyExtract,
    concurrencyWrite   : config.concurrencyWrite,
    escalationCap      : config.escalationCap,
    dryRun             : config.dryRun,
    censusOnly         : config.censusOnly,
    exportPath         : config.exportPath,
  });

  console.log(renderReport(report, config.dryRun));
  process.exit(report.failed > 0 ? 2 : 0);
};

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
