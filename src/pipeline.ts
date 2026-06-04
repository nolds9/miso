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
  Recipe,
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

const recordRecipe = (
  outcomes: ReelOutcome[],
  url: string,
  recipe: Recipe,
): void => {
  outcomes.push({
    kind: "written",
    url,
    name: recipe.name,
    tier: recipe.sourceTier,
    cuisine: recipe.cuisine,
    mealType: recipe.mealType,
  });
};

// Classify + optionally write each reel (shared by full, dry, and census runs).
const classifyReels = async (
  reels: readonly Reel[],
  deps: PipelineDeps,
  outcomes: ReelOutcome[],
  proposedNew: string[],
): Promise<void> => {
  const skipWrite = deps.censusOnly || deps.dryRun;
  const extractLimit = pLimit(deps.concurrencyExtract);
  const writeLimit   = pLimit(deps.concurrencyWrite);
  const pageMapper   = toNotionPage(deps.databaseId, deps.vocab, proposedNew);

  let done = 0;
  const logProgress = (): void => {
    if (!deps.censusOnly) return;
    done++;
    if (done % 25 === 0 || done === reels.length) {
      console.log(`  Classified ${done}/${reels.length}…`);
    }
  };

  await Promise.all(
    reels.map((reel) =>
      extractLimit(async () => {
        try {
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

          if (extraction.kind === "partial") {
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
              outcomes.push({
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
              });
              return;
            }

            const reExtract = await deps.extractRecipe(enriched);
            if (!reExtract.ok || reExtract.value.kind !== "recipe") {
              outcomes.push({
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
              });
              return;
            }

            const recipe = reExtract.value.recipe;
            if (skipWrite) {
              recordRecipe(outcomes, reel.url, recipe);
              return;
            }

            const page = pageMapper(enriched, recipe);
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
            recordRecipe(outcomes, reel.url, recipe);
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

          const recipe = extraction.recipe;
          if (skipWrite) {
            recordRecipe(outcomes, reel.url, recipe);
            return;
          }

          const page = pageMapper(reel, recipe);
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
          recordRecipe(outcomes, reel.url, recipe);
        } finally {
          logProgress();
        }
      }),
    ),
  );
};

export const runPipeline = async (deps: PipelineDeps): Promise<RunReport> => {
  const start = Date.now();
  const outcomes: ReelOutcome[] = [];
  const proposedNew: string[] = [];

  const exportResult = await deps.readExport(deps.exportPath);
  if (!exportResult.ok) {
    throw new Error(`Failed to read export: ${exportResult.error.message}`);
  }

  const reels: Reel[] = exportResult.value.map(normalizeReel);

  // Census: classify every reel in the export (no Notion dedup or writes).
  if (deps.censusOnly) {
    await classifyReels(reels, deps, outcomes, proposedNew);
    return buildReport(start, reels.length, outcomes, proposedNew);
  }

  const seen = await deps.existingSourceUrls();
  const fresh = reels.filter(
    (r) => !seen.has(r.reelId) && !seen.has(r.url),
  );

  for (const r of reels) {
    if (seen.has(r.reelId) || seen.has(r.url)) {
      outcomes.push({ kind: "duplicate", url: r.url });
    }
  }

  await classifyReels(fresh, deps, outcomes, proposedNew);
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
        cuisineTally[o.cuisine] = (cuisineTally[o.cuisine] ?? 0) + 1;
        mealTypeTally[o.mealType] = (mealTypeTally[o.mealType] ?? 0) + 1;
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
