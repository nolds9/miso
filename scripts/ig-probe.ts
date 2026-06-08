#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// ig-probe — fetch comment for one reel URL (dev / selector tuning)
//
// Usage:
//   ENRICH_HEADLESS=false pnpm run ig:probe -- https://www.instagram.com/reel/SHORTCODE/
// ---------------------------------------------------------------------------

import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnrichConfig } from "../src/enrich/index.ts";
import { createBrowserPool } from "../src/enrich/browser-pool.ts";
import { parseReelId, readExport, normalizeReel } from "../src/transforms.ts";
import type { Reel } from "../src/ports.ts";
import { EnrichError } from "../src/enrich/types.ts";

const lookupReel = async (url: string): Promise<Partial<Reel> | null> => {
  const exportPath = process.env["EXPORT_PATH"] ?? "saved_posts.json";
  const result = await readExport(exportPath);
  if (!result.ok) return null;
  const id = parseReelId(url);
  const entry = result.value.find((e) => {
    const r = normalizeReel(e);
    return r.reelId === id || r.url === url;
  });
  return entry ? normalizeReel(entry) : null;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const dashIdx = argv.indexOf("--");
  const url = (dashIdx >= 0 ? argv.slice(dashIdx + 1) : argv).find((a) =>
    a.startsWith("http"),
  );

  if (!url) {
    console.error("Usage: pnpm run ig:probe -- <reel-url>");
    process.exit(1);
  }

  const config = {
    ...loadEnrichConfig(),
    enabled: true,
    headless: process.env["ENRICH_HEADLESS"] !== "false",
  };

  const fromExport = await lookupReel(url);
  const reel: Reel = {
    url,
    reelId: parseReelId(url),
    creator: fromExport?.creator ?? "",
    handle: process.env["IG_PROBE_HANDLE"] ?? fromExport?.handle ?? "",
    savedAt: fromExport?.savedAt ?? new Date(),
    caption: fromExport?.caption ?? "",
    hashtags: fromExport?.hashtags ?? [],
    availableTier: "caption",
  };

  if (fromExport?.handle) {
    console.error(`Using export owner: @${fromExport.handle}`);
  }

  const pool = await createBrowserPool(config);
  try {
    const result = await pool.fetchComment(reel);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const code = e instanceof EnrichError ? e.code : "unknown";
    console.error(`Error [${code}]:`, e instanceof Error ? e.message : String(e));

    if (process.env["ENRICH_HEADLESS"] === "false") {
      const debugDir = join(config.dataDir, "debug");
      await mkdir(debugDir, { recursive: true });
      console.error(`(Re-run with browser visible; screenshots not auto-captured in probe v1)`);
    }
    process.exit(1);
  } finally {
    await pool.dispose();
  }
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
