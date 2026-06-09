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
import {
  shouldSkipCommentEnrich,
  skipEnrichReason,
} from "./enrich/skip-enrich.ts";
import { EnrichError } from "./enrich/types.ts";

/** Reels that timed out on a prior run — retried once at end of pipeline. */
export const RETRY_EXTRACT_URLS: readonly string[] = [
  "https://www.instagram.com/reel/DNX7GrXuKPV/",
  "https://www.instagram.com/reel/DRZ4OhmkbFj/",
  "https://www.instagram.com/reel/DS8pB6_DzSq/",
  "https://www.instagram.com/reel/DSQj0cPEtbj/",
  "https://www.instagram.com/reel/DSWxPWljnKd/",
  "https://www.instagram.com/reel/DRCz6-1iSb-/",
  "https://www.instagram.com/reel/DKt0uLMtUit/",
  "https://www.instagram.com/reel/DFNmGL7JCut/",
];

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
  readonly verbose: boolean;
};

const logOutcome = (verbose: boolean, outcome: ReelOutcome): void => {
  if (!verbose) return;

  switch (outcome.kind) {
    case "partial":
      console.log(
        `  [partial] ${outcome.note ?? `missing: ${outcome.missing.join(", ")}`} — ${outcome.url}`,
      );
      break;
    case "failed":
      console.log(
        `  [failed/${outcome.stage}] ${outcome.message} — ${outcome.url}`,
      );
      break;
    case "written":
      console.log(
        `  [written] ${outcome.name} (${outcome.tier}) — ${outcome.url}`,
      );
      break;
    default:
      break;
  }
};

const pushOutcome = (
  outcomes: ReelOutcome[],
  outcome: ReelOutcome,
  verbose: boolean,
): void => {
  outcomes.push(outcome);
  logOutcome(verbose, outcome);
};

const recordRecipe = (
  outcomes: ReelOutcome[],
  url: string,
  recipe: Recipe,
  verbose: boolean,
): void => {
  pushOutcome(
    outcomes,
    {
      kind: "written",
      url,
      name: recipe.name,
      tier: recipe.sourceTier,
      cuisine: recipe.cuisine,
      mealType: recipe.mealType,
    },
    verbose,
  );
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
    done++;
    if (done % 25 !== 0 && done !== reels.length) return;
    if (deps.censusOnly) {
      console.log(`  Classified ${done}/${reels.length}…`);
    } else if (deps.verbose) {
      console.log(`  Processed ${done}/${reels.length}…`);
    }
  };

  await Promise.all(
    reels.map((reel) =>
      extractLimit(async () => {
        try {
          const extractResult = await deps.extractRecipe(reel);
          if (!extractResult.ok) {
            pushOutcome(outcomes, {
              kind: "failed",
              url: reel.url,
              stage: "extract",
              message: extractResult.error.message,
            }, deps.verbose);
            return;
          }

          const extraction = extractResult.value;

          if (extraction.kind === "partial") {
            if (shouldSkipCommentEnrich(reel)) {
              pushOutcome(outcomes, {
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
                note: skipEnrichReason(reel),
              }, deps.verbose);
              return;
            }

            const enrichResult = await deps.enrichReel(reel, "caption+comment");
            if (!enrichResult.ok) {
              pushOutcome(outcomes, {
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
                note:
                  enrichResult.error instanceof EnrichError
                    ? enrichResult.error.code
                    : enrichResult.error.message,
              }, deps.verbose);
              return;
            }

            const enriched = enrichResult.value;
            const hasNewContext =
              enriched.firstComment !== reel.firstComment ||
              enriched.transcript   !== reel.transcript   ||
              enriched.onScreenText !== reel.onScreenText;

            if (!hasNewContext) {
              pushOutcome(outcomes, {
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
                note: shouldSkipCommentEnrich(reel)
                  ? skipEnrichReason(reel)
                  : "enrich_no_new_context",
              }, deps.verbose);
              return;
            }

            const reExtract = await deps.extractRecipe(enriched);
            if (!reExtract.ok || reExtract.value.kind !== "recipe") {
              pushOutcome(outcomes, {
                kind: "partial",
                url: reel.url,
                missing: extraction.missing,
                note: reExtract.ok ? "still_partial_after_enrich" : "re_extract_failed",
              }, deps.verbose);
              return;
            }

            const recipe = reExtract.value.recipe;
            if (skipWrite) {
              recordRecipe(outcomes, reel.url, recipe, deps.verbose);
              return;
            }

            const page = pageMapper(enriched, recipe);
            const writeResult = await writeLimit(() => deps.writeRecipe(page));
            if (!writeResult.ok) {
              pushOutcome(outcomes, {
                kind: "failed",
                url: reel.url,
                stage: "write",
                message: writeResult.error.message,
              }, deps.verbose);
              return;
            }
            recordRecipe(outcomes, reel.url, recipe, deps.verbose);
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
            recordRecipe(outcomes, reel.url, recipe, deps.verbose);
            return;
          }

          const page = pageMapper(reel, recipe);
          const writeResult = await writeLimit(() => deps.writeRecipe(page));
          if (!writeResult.ok) {
            pushOutcome(outcomes, {
              kind: "failed",
              url: reel.url,
              stage: "write",
              message: writeResult.error.message,
            }, deps.verbose);
            return;
          }
          recordRecipe(outcomes, reel.url, recipe, deps.verbose);
        } finally {
          logProgress();
        }
      }),
    ),
  );
};

const retryExtractFailures = async (
  reels: readonly Reel[],
  outcomes: ReelOutcome[],
  proposedNew: string[],
  deps: PipelineDeps,
  urls: readonly string[],
): Promise<void> => {
  const urlSet = new Set(urls);
  const failedUrls = outcomes
    .filter(
      (o): o is Extract<ReelOutcome, { kind: "failed" }> =>
        o.kind === "failed" && o.stage === "extract" && urlSet.has(o.url),
    )
    .map((o) => o.url);

  if (failedUrls.length === 0) return;

  console.log(`\nRetrying ${failedUrls.length} timed-out extraction(s)…`);

  const retrySet = new Set(failedUrls);
  const keep = outcomes.filter(
    (o) => !(o.kind === "failed" && o.stage === "extract" && retrySet.has(o.url)),
  );
  outcomes.splice(0, outcomes.length, ...keep);

  const toRetry = reels.filter((r) => retrySet.has(r.url));
  await classifyReels(toRetry, { ...deps, concurrencyExtract: 1 }, outcomes, proposedNew);
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
    await retryExtractFailures(reels, outcomes, proposedNew, deps, RETRY_EXTRACT_URLS);
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
  await retryExtractFailures(reels, outcomes, proposedNew, deps, RETRY_EXTRACT_URLS);
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
