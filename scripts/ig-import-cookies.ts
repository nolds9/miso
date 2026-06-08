#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// ig-import-cookies — Netscape cookies.txt → Playwright ig-storage.json
//
// Usage:
//   IG_COOKIES_PATH=./cookies.txt pnpm run ig:import-cookies
// ---------------------------------------------------------------------------

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseNetscapeCookies,
  toStorageState,
  validateInstagramCookies,
} from "../src/enrich/netscape.ts";
import { writeStorageState } from "../src/enrich/storage.ts";
import { loadEnrichConfig } from "../src/enrich/index.ts";

const main = async (): Promise<void> => {
  const config = loadEnrichConfig();
  const cookiesPath = resolve(
    process.env["IG_COOKIES_PATH"] ?? "cookies.txt",
  );
  const outPath = resolve(
    process.env["IG_STORAGE_PATH"] ?? config.storagePath,
  );

  console.log(`Reading Netscape cookies: ${cookiesPath}`);
  const raw = await readFile(cookiesPath, "utf8");
  const cookies = parseNetscapeCookies(raw);

  if (cookies.length === 0) {
    console.error("No instagram.com cookies found in file.");
    process.exit(1);
  }

  const check = validateInstagramCookies(cookies);
  if (!check.ok) {
    console.warn(
      `Warning: missing recommended cookies: ${check.missing.join(", ")}`,
    );
  } else {
    console.log("Required cookies present: sessionid, csrftoken");
  }

  await writeStorageState(outPath, toStorageState(cookies));
  console.log(`Wrote ${cookies.length} cookies → ${outPath}`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
