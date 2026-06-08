// ---------------------------------------------------------------------------
// fetch-comment.ts — Playwright navigation + comment extraction
// ---------------------------------------------------------------------------

import type { Browser, BrowserContext, Page } from "playwright";
import type { Reel } from "../ports.ts";
import type { EnrichConfig, CommentFetchResult } from "./types.ts";
import { EnrichError } from "./types.ts";
import { SELECTORS, USER_AGENT, VIEWPORT } from "./selectors.ts";
import { pickBestComment } from "./pick-comment.ts";
import type { CommentCandidate } from "./types.ts";
import { EXTRACT_COMMENTS_BROWSER_FN } from "./extract-comments-browser.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const randomDelay = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

const dismissOverlays = async (page: Page): Promise<void> => {
  for (const sel of SELECTORS.dismissOverlays) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 2000 });
        await sleep(400);
      }
    } catch {
      // optional overlay
    }
  }
};

const openCommentsPanel = async (page: Page): Promise<void> => {
  for (const sel of SELECTORS.openComments) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click({ timeout: 3000 });
        await sleep(1200);
        return;
      }
    } catch {
      // try next selector
    }
  }
};

const isLoginWall = async (page: Page): Promise<boolean> => {
  for (const sel of SELECTORS.loginWall) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 1500 })) {
        return true;
      }
    } catch {
      // continue
    }
  }
  const url = page.url();
  return url.includes("/accounts/login");
};

/** Extract comment candidates from the live page DOM. */
export const extractCommentCandidates = async (
  page: Page,
  ownerHandle: string,
  caption = "",
): Promise<CommentCandidate[]> => {
  const result = await page.evaluate(
    `(${EXTRACT_COMMENTS_BROWSER_FN})(${JSON.stringify(ownerHandle)}, ${JSON.stringify(caption)})`,
  );
  if (!Array.isArray(result)) {
    throw new EnrichError(
      "selector_miss",
      "Comment extraction returned no data (page may not have loaded)",
    );
  }
  return result as CommentCandidate[];
};

export const fetchCommentForReel = async (
  context: BrowserContext,
  reel: Reel,
  config: EnrichConfig,
): Promise<CommentFetchResult> => {
  const page = await context.newPage();
  try {
    await page.goto(reel.url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs,
    });

    await dismissOverlays(page);

    if (await isLoginWall(page)) {
      throw new EnrichError("login_wall", "Redirected to Instagram login");
    }

    await openCommentsPanel(page);

    for (const sel of SELECTORS.loadMoreComments) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ timeout: 3000 });
          await sleep(1200);
          break;
        }
      } catch {
        // optional
      }
    }

    for (const sel of SELECTORS.commentThread) {
      try {
        await page.locator(sel).first().waitFor({ state: "visible", timeout: 6_000 });
        break;
      } catch {
        // try next
      }
    }

    const candidates = await extractCommentCandidates(
      page,
      reel.handle,
      reel.caption,
    );
    const best = pickBestComment(candidates, reel.handle);

    if (!best) {
      throw new EnrichError(
        "no_comment",
        candidates.length === 0 ? "No comment nodes found" : "No usable comment text",
      );
    }

    return { text: best.text, source: best.source };
  } catch (e) {
    if (e instanceof EnrichError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) {
      throw new EnrichError("timeout", msg);
    }
    throw new EnrichError("selector_miss", msg);
  } finally {
    await page.close();
  }
};

export const createBrowserContext = async (
  browser: Browser,
  storagePath: string,
): Promise<BrowserContext> =>
  browser.newContext({
    storageState: storagePath,
    userAgent: USER_AGENT,
    locale: "en-US",
    viewport: VIEWPORT,
  });
