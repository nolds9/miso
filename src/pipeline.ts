// ---------------------------------------------------------------------------
// pipeline.ts — the composed pipeline (read → normalize → dedupe → extract → write)
//
// All side-effects are injected as port functions. The pipeline itself is
// a pure composition — no globals, no direct I/O.
// ---------------------------------------------------------------------------

import pLimit from "p-limit";
import type {
  ReadExport,
  ExistingSourceUrls,
  ExtractRecipe,
  EnrichReel,
  WriteRecipe,
  NotionVocab,
  Reel,
  RunReport,
  ReelOutcome,
  ExtractionTier,
} from "./ports.ts";
import { normalizeReel } from "./transforms.ts";
import { toNotionPage } from "./notion.ts";

export type PipelineDeps = {
  readonly readExport: ReadExport;
  readonly existingSourceUrls: ExistingSourceUrls;
  readonly extractRecipe: ExtractRecipe;
  readonly enrichReel: EnrichReel;
  readonly writeRecipe: WriteRecipe;
  readonly vocab: NotionVocab;
  readonly databaseId: string;
  readonly concurrencyExtract: number;
  readonly concurrencyWrite: number;
  readonly escalationCap: number;
  readonly dryRun: boolean;
  readonly censusOnly: boolean;
  readonly exportPath: string;
};

export const runPipeline = async (deps: PipelineDeps): Promise<RunReport> => {
  const start = Date.now();
  const outcomes: ReelOutcome[] = [];
  const proposedNew: string[] = [];

  // 1. Read + parse export ─────────────────────────────────────────────────
  const exportResult = await deps.readExport(deps.exportPath);
  if (!exportResult.ok) {
    throw new Error(`Failed to read export: ${exportResult.error.message}`);
  }
  const entries = exportResult.value;

  // 2. Normalize (pure) ────────────────────────────────────────────────────
  const reels: Reel[] = entries.map(normalizeReel);

  // 3. Dedup against existing Notion pages ─────────────────────────────────
  const seen = await deps.existingSourceUrls();
  const fresh = reels.filter(
    (r) => !seen.has(r.reelId) && !seen.has(r.url),
  );

  for (const r of reels) {
    if (seen.has(r.reelId) || seen.has(r.url)) {
      outcomes.push({ kind: "duplicate", url: r.url });
    }
  }

  // Census mode: stop here, report domain distribution
  if (deps.censusOnly) {
    return buildReport(start, reels.length, outcomes, proposedNew);
  }

  // 4. Extract + write (bounded concurrency) ───────────────────────────────
  const extractLimit = pLimit(deps.concurrencyExtract);
  const writeLimit   = pLimit(deps.concurrencyWrite);
  const pageMapper   = toNotionPage(deps.databaseId, deps.vocab, proposedNew);

  await Promise.all(
    fresh.map((reel) =>
      extractLimit(async () => {
        // 4a. Extract (tier-0: Gemini)
        const extractResult = await deps.extractRecipe(reel);
        if (!extractResult.ok) {
          outcomes.push({
            kind: "failed",
            url: reel.url,
            stage: "extract",
            message: extractResult.error.message,
          });
          return;
        }

        const extraction = extractResult.value;

        // 4b. Handle partial → enrichReel (stub) → re-extract if enriched
        if (extraction.kind === "partial") {
          // Try enrichment once (stub returns reel unchanged)
          const enrichResult = await deps.enrichReel(reel, "caption+comment");
          if (!enrichResult.ok) {
            outcomes.push({
              kind: "partial",
              url: reel.url,
              missing: extraction.missing,
            });
            return;
          }

          const enriched = enrichResult.value;
          const hasNewContext =
            enriched.firstComment !== reel.firstComment ||
            enriched.transcript   !== reel.transcript   ||
            enriched.onScreenText !== reel.onScreenText;

          if (!hasNewContext) {
            // Stub returned unchanged reel — record partial, skip write
            outcomes.push({
              kind: "partial",
              url: reel.url,
              missing: extraction.missing,
            });
            return;
          }

          // Re-extract with enriched context (bounded escalation)
          const reExtract = await deps.extractRecipe(enriched);
          if (!reExtract.ok || reExtract.value.kind !== "recipe") {
            outcomes.push({
              kind: "partial",
              url: reel.url,
              missing: extraction.missing,
            });
            return;
          }

          // Fall through with the re-extracted recipe
          const page = pageMapper(enriched, reExtract.value.recipe);
          if (!deps.dryRun) {
            const writeResult = await writeLimit(() => deps.writeRecipe(page));
            if (!writeResult.ok) {
              outcomes.push({
                kind: "failed",
                url: reel.url,
                stage: "write",
                message: writeResult.error.message,
              });
              return;
            }
          }
          outcomes.push({
            kind: "written",
            url: reel.url,
            name: reExtract.value.recipe.name,
            tier: reExtract.value.recipe.sourceTier,
          });
          return;
        }

        if (extraction.kind === "no-recipe") {
          outcomes.push({
            kind: "no-recipe",
            url: reel.url,
            reason: extraction.reason,
          });
          return;
        }

        // 4c. recipe → map to Notion page → write
        const page = pageMapper(reel, extraction.recipe);
        if (!deps.dryRun) {
          const writeResult = await writeLimit(() => deps.writeRecipe(page));
          if (!writeResult.ok) {
            outcomes.push({
              kind: "failed",
              url: reel.url,
              stage: "write",
              message: writeResult.error.message,
            });
            return;
          }
        }
        outcomes.push({
          kind: "written",
          url: reel.url,
          name: extraction.recipe.name,
          tier: extraction.recipe.sourceTier,
        });
      }),
    ),
  );

  return buildReport(start, reels.length, outcomes, proposedNew);
};

// ── Report builder ─────────────────────────────────────────────────────────

const buildReport = (
  startMs: number,
  total: number,
  outcomes: readonly ReelOutcome[],
  proposedNew: readonly string[],
): RunReport => {
  const cuisineTally: Record<string, number> = {};
  const mealTypeTally: Record<string, number> = {};
  const tierTally: Record<ExtractionTier, number> = {
    caption: 0,
    "caption+comment": 0,
    multimodal: 0,
  };

  let written = 0, duplicate = 0, noRecipe = 0, partial = 0, failed = 0;

  for (const o of outcomes) {
    switch (o.kind) {
      case "written":
        written++;
        tierTally[o.tier] = (tierTally[o.tier] ?? 0) + 1;
        break;
      case "duplicate": duplicate++; break;
      case "no-recipe": noRecipe++;  break;
      case "partial":   partial++;   break;
      case "failed":    failed++;    break;
    }
  }

  return {
    total,
    written,
    duplicate,
    noRecipe,
    partial,
    failed,
    cuisineTally,
    mealTypeTally,
    tierTally,
    outcomes,
    durationMs: Date.now() - startMs,
    proposedNewValues: [...new Set(proposedNew)],
  };
};
