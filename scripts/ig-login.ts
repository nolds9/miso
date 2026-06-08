#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// ig-login — manual Instagram login → save Playwright storageState
//
// Usage:
//   pnpm run ig:login
// ---------------------------------------------------------------------------

import "dotenv/config";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnrichConfig } from "../src/enrich/index.ts";
import { USER_AGENT, VIEWPORT } from "../src/enrich/selectors.ts";

const main = async (): Promise<void> => {
  const config = loadEnrichConfig();
  const outPath = resolve(
    process.env["IG_STORAGE_PATH"] ?? config.storagePath,
  );

  await mkdir(dirname(outPath), { recursive: true });

  console.log("Opening Chromium — log into Instagram, then press Enter here.");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
    viewport: VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "domcontentloaded",
  });

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    console.log("Press Enter after you have logged in…");
  });

  await context.storageState({ path: outPath });
  console.log(`Saved storage state → ${outPath}`);

  await browser.close();
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
