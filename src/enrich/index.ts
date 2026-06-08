// ---------------------------------------------------------------------------
// enrich/index.ts — makeEnrichReel() EnrichReel port implementation
// ---------------------------------------------------------------------------

import type { Reel, ExtractionTier } from "../ports.ts";
import { ok, err } from "../result.ts";
import type { EnrichConfig } from "./types.ts";
import { EnrichError } from "./types.ts";
import type { EnrichReelFactory } from "./types.ts";
import { readCachedComment, writeCachedComment } from "./cache.ts";
import { createBrowserPool, type BrowserPool } from "./browser-pool.ts";
import { shouldSkipCommentEnrich } from "./skip-enrich.ts";
import { isUsefulRecipeComment } from "./comment-quality.ts";
import { isAudioOrReelUiNoise } from "./comment-filters.ts";

export const loadEnrichConfig = (): EnrichConfig => {
  const homedir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const defaultDataDir = homedir ? `${homedir}/.miso` : ".miso";

  const dataDir =
    process.env["MISO_DATA_DIR"] ?? defaultDataDir;

  const storagePath =
    process.env["IG_STORAGE_PATH"] ?? `${dataDir}/ig-storage.json`;

  const cacheDir =
    process.env["ENRICH_CACHE_DIR"] ?? `${dataDir}/enrich-cache`;

  const int = (val: string | undefined, fallback: number): number => {
    const n = parseInt(val ?? "", 10);
    return isNaN(n) ? fallback : n;
  };

  const bool = (val: string | undefined, fallback: boolean): boolean => {
    if (val === undefined) return fallback;
    return val.toLowerCase() === "true" || val === "1";
  };

  return {
    enabled: bool(process.env["ENRICH_ENABLED"], false),
    storagePath,
    dataDir,
    cacheDir,
    cacheTtlDays: int(process.env["ENRICH_CACHE_TTL_DAYS"], 30),
    concurrency: int(process.env["CONCURRENCY_ENRICH"], 2),
    headless: bool(process.env["ENRICH_HEADLESS"], true),
    timeoutMs: int(process.env["ENRICH_TIMEOUT_MS"], 30_000),
    minDelayMs: int(process.env["ENRICH_MIN_DELAY_MS"], 800),
    maxDelayMs: int(process.env["ENRICH_MAX_DELAY_MS"], 2000),
  };
};

export const makeEnrichReel = (config: EnrichConfig): EnrichReelFactory => {
  let pool: BrowserPool | null = null;
  let poolInit: Promise<BrowserPool> | null = null;

  const getPool = (): Promise<BrowserPool> => {
    if (pool) return Promise.resolve(pool);
    if (!poolInit) {
      poolInit = createBrowserPool(config).then((p) => {
        pool = p;
        return p;
      });
    }
    return poolInit;
  };

  const enrich = async (
    reel: Reel,
    toTier: ExtractionTier,
  ): Promise<import("../result.ts").Result<Reel, EnrichError>> => {
    if (!config.enabled) {
      return ok(reel);
    }

    if (toTier === "multimodal") {
      return err(
        new EnrichError("not_implemented", "multimodal enrichment is not implemented"),
      );
    }

    if (toTier !== "caption+comment") {
      return ok(reel);
    }

    if (reel.firstComment) {
      return ok(reel);
    }

    if (shouldSkipCommentEnrich(reel)) {
      return ok(reel);
    }

    const cached = await readCachedComment(
      config.cacheDir,
      reel.reelId,
      config.cacheTtlDays,
    );
    if (cached) {
      if (
        !isAudioOrReelUiNoise(cached.firstComment) &&
        isUsefulRecipeComment(cached.firstComment, cached.source)
      ) {
        return ok({
          ...reel,
          firstComment: cached.firstComment,
          availableTier: "caption+comment",
        });
      }
    }

    try {
      const p = await getPool();
      const result = await p.fetchComment(reel);

      if (
        isAudioOrReelUiNoise(result.text) ||
        !isUsefulRecipeComment(result.text, result.source)
      ) {
        return err(
          new EnrichError("no_comment", "Fetched text is not a usable recipe comment"),
        );
      }

      await writeCachedComment(config.cacheDir, {
        reelId: reel.reelId,
        url: reel.url,
        firstComment: result.text,
        fetchedAt: new Date().toISOString(),
        source: result.source,
      });

      return ok({
        ...reel,
        firstComment: result.text,
        availableTier: "caption+comment",
      });
    } catch (e) {
      const error =
        e instanceof EnrichError
          ? e
          : new EnrichError("selector_miss", e instanceof Error ? e.message : String(e));
      return err(error);
    }
  };

  const dispose = async (): Promise<void> => {
    if (pool) {
      await pool.dispose();
      pool = null;
      poolInit = null;
    }
  };

  return { enrich, dispose };
};

/** Adapter matching the EnrichReel port signature. */
export const enrichReelFromFactory = (
  factory: EnrichReelFactory,
): import("../ports.ts").EnrichReel => factory.enrich;
