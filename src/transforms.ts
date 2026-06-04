// ---------------------------------------------------------------------------
// transforms.ts — pure normalization functions (no I/O, fully unit-testable)
// ---------------------------------------------------------------------------

import type { ExportEntry, LabelValue, DictGroup, Reel } from "./ports.ts";

// ── Mojibake repair ────────────────────────────────────────────────────────
// The Instagram export stores captions as UTF-8 bytes decoded as latin-1 and
// then JSON-escaped.  Example: 🦐 (U+1F990, UTF-8: F0 9F A6 90) appears as
// \u00f0\u009f\u00a6\u0090.  Fix: treat the JS string as latin-1 bytes and
// decode as UTF-8.

export const repairMojibake = (s: string): string =>
  Buffer.from(s, "latin1").toString("utf8");

// ── Label-value accessors ──────────────────────────────────────────────────

const scalar = (
  lvs: readonly LabelValue[],
  label: string,
): string | undefined =>
  lvs.find(
    (lv): lv is Extract<LabelValue, { label: string }> =>
      "label" in lv && lv.label === label,
  )?.value;

const group = (
  lvs: readonly LabelValue[],
  title: string,
): readonly DictGroup[] =>
  (
    lvs.find(
      (lv): lv is Extract<LabelValue, { title: string }> =>
        "title" in lv && lv.title === title,
    ) as Extract<LabelValue, { title: string }> | undefined
  )?.dict ?? [];

// ── Reel ID extraction ─────────────────────────────────────────────────────
// Parse the stable shortcode from the reel permalink.
// https://www.instagram.com/reel/DY5ZbwuxiNs/ → "DY5ZbwuxiNs"
// Used as the dedup key (robust to query-string / trailing-slash differences).

export const parseReelId = (url: string): string => {
  const m = url.match(/\/reel\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? url; // fall back to full URL if parsing fails
};

// ── normalizeReel ──────────────────────────────────────────────────────────

export const normalizeReel = (entry: ExportEntry): Reel => {
  const lvs = entry.label_values;

  const url = scalar(lvs, "URL") ?? "";
  const caption = repairMojibake(scalar(lvs, "Caption") ?? "");

  const hashtags = group(lvs, "Hashtags")
    .flatMap((g) => g.dict)
    .filter((d) => d.label === "Name")
    .map((d) => d.value);

  const ownerGroups = group(lvs, "Owner");
  const ownerDict = ownerGroups[0]?.dict ?? [];
  const find = (label: string): string =>
    ownerDict.find((d) => d.label === label)?.value ?? "";

  return {
    url,
    reelId: parseReelId(url),
    creator: repairMojibake(find("Name")),
    handle: find("Username"),
    savedAt: new Date(entry.timestamp * 1000),
    caption,
    hashtags,
    availableTier: "caption",
  };
};

// ── readExport (thin effectful wrapper around the pure parser) ─────────────

import type { ReadExport } from "./ports.ts";
import { ok, err } from "./result.ts";
import { readFile } from "node:fs/promises";

export const readExport: ReadExport = async (path) => {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return err(new Error("saved_posts.json root is not an array"));
    }
    return ok(parsed as ExportEntry[]);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
