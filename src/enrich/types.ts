// ---------------------------------------------------------------------------
// enrich/types.ts — Tier-1 Playwright enrichment configuration and results
// ---------------------------------------------------------------------------

import type { ExtractionTier } from "../ports.ts";

export type EnrichErrorCode =
  | "login_wall"
  | "no_comment"
  | "timeout"
  | "selector_miss"
  | "not_implemented"
  | "disabled"
  | "storage_missing";

export class EnrichError extends Error {
  readonly code: EnrichErrorCode;

  constructor(code: EnrichErrorCode, message: string) {
    super(message);
    this.name = "EnrichError";
    this.code = code;
  }
}

export type EnrichConfig = {
  readonly enabled: boolean;
  readonly storagePath: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly cacheTtlDays: number;
  readonly concurrency: number;
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
};

export type CommentSource = "pinned" | "top" | "owner";

export type CommentCandidate = {
  readonly text: string;
  readonly author?: string;
  readonly source: CommentSource;
  readonly isPinned?: boolean;
};

export type CommentFetchResult = {
  readonly text: string;
  readonly source: CommentSource;
};

export type CachedComment = {
  readonly reelId: string;
  readonly url: string;
  readonly firstComment: string;
  readonly fetchedAt: string;
  readonly source: CommentSource;
};

export type EnrichReelFactory = {
  readonly enrich: (reel: import("../ports.ts").Reel, toTier: ExtractionTier) => Promise<import("../result.ts").Result<import("../ports.ts").Reel, EnrichError>>;
  readonly dispose: () => Promise<void>;
};
