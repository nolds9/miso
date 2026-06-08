// ---------------------------------------------------------------------------
// browser-pool.ts — shared Chromium instance + concurrency-limited fetches
// ---------------------------------------------------------------------------

import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Reel } from "../ports.ts";
import type { EnrichConfig, CommentFetchResult } from "./types.ts";
import { loadStorageState } from "./storage.ts";
import { createBrowserContext, fetchCommentForReel } from "./fetch-comment.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const randomDelay = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

export type BrowserPool = {
  readonly fetchComment: (reel: Reel) => Promise<CommentFetchResult>;
  readonly dispose: () => Promise<void>;
};

export const createBrowserPool = async (
  config: EnrichConfig,
): Promise<BrowserPool> => {
  await loadStorageState(config.storagePath);

  const browser: Browser = await chromium.launch({
    headless: config.headless,
  });

  const context: BrowserContext = await createBrowserContext(
    browser,
    config.storagePath,
  );

  let active = 0;
  const queue: (() => void)[] = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < config.concurrency) {
        active++;
        resolve();
        return;
      }
      queue.push(() => {
        active++;
        resolve();
      });
    });

  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  let lastFetchAt = 0;

  const throttle = async (): Promise<void> => {
    const delay = randomDelay(config.minDelayMs, config.maxDelayMs);
    const elapsed = Date.now() - lastFetchAt;
    if (elapsed < delay) {
      await sleep(delay - elapsed);
    }
    lastFetchAt = Date.now();
  };

  return {
    fetchComment: async (reel: Reel): Promise<CommentFetchResult> => {
      await acquire();
      try {
        await throttle();
        return await fetchCommentForReel(context, reel, config);
      } finally {
        release();
      }
    },
    dispose: async (): Promise<void> => {
      await context.close();
      await browser.close();
    },
  };
};
