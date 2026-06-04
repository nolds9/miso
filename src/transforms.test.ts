// ---------------------------------------------------------------------------
// transforms.test.ts — unit tests for the pure normalization layer
// Run with: pnpm test
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { repairMojibake, parseReelId, normalizeReel } from "./transforms.ts";
import type { ExportEntry } from "./ports.ts";

// ── repairMojibake ─────────────────────────────────────────────────────────

describe("repairMojibake", () => {
  it("repairs the shrimp emoji fixture from the architecture doc", () => {
    // 🦐 (U+1F990) → F0 9F A6 90 → latin-1 decoded → \u00f0\u009f\u00a6\u0090
    const mangled = "\u00f0\u009f\u00a6\u0090";
    expect(repairMojibake(mangled)).toBe("🦐");
  });

  it("repairs bullet • (U+2022 → E2 80 A2)", () => {
    const mangled = "\u00e2\u0080\u00a2";
    expect(repairMojibake(mangled)).toBe("•");
  });

  it("repairs en-dash – (U+2013 → E2 80 93)", () => {
    const mangled = "\u00e2\u0080\u0093";
    expect(repairMojibake(mangled)).toBe("–");
  });

  it("leaves plain ASCII unchanged", () => {
    expect(repairMojibake("Hello, world!")).toBe("Hello, world!");
  });

  it("handles empty string", () => {
    expect(repairMojibake("")).toBe("");
  });
});

// ── parseReelId ────────────────────────────────────────────────────────────

describe("parseReelId", () => {
  it("extracts the shortcode from a canonical reel URL", () => {
    expect(parseReelId("https://www.instagram.com/reel/DY5ZbwuxiNs/")).toBe("DY5ZbwuxiNs");
  });

  it("handles URLs without trailing slash", () => {
    expect(parseReelId("https://www.instagram.com/reel/ABC123")).toBe("ABC123");
  });

  it("falls back to the full URL when no /reel/ segment", () => {
    const url = "https://www.instagram.com/p/ABC123/";
    expect(parseReelId(url)).toBe(url);
  });
});

// ── normalizeReel ──────────────────────────────────────────────────────────

const makeEntry = (overrides: Partial<{
  caption: string;
  url: string;
  hashtags: string[];
  ownerName: string;
  ownerUsername: string;
  timestamp: number;
}>): ExportEntry => ({
  timestamp: overrides.timestamp ?? 1780104131,
  media: [],
  label_values: [
    { label: "URL",     value: overrides.url ?? "https://www.instagram.com/reel/TEST123/" },
    { label: "Caption", value: overrides.caption ?? "" },
    { label: "Title",   value: "" },
    {
      title: "Hashtags",
      dict: (overrides.hashtags ?? ["food", "recipe"]).map((h) => ({
        title: "",
        dict: [{ label: "Name", value: h }],
      })),
    },
    {
      title: "Owner",
      dict: [{
        title: "",
        dict: [
          { label: "Name",     value: overrides.ownerName     ?? "Test Creator" },
          { label: "Username", value: overrides.ownerUsername ?? "testcreator" },
        ],
      }],
    },
  ],
  fbid: "test-fbid",
});

describe("normalizeReel", () => {
  it("extracts url, reelId, creator, handle, hashtags", () => {
    const reel = normalizeReel(makeEntry({}));
    expect(reel.url).toBe("https://www.instagram.com/reel/TEST123/");
    expect(reel.reelId).toBe("TEST123");
    expect(reel.creator).toBe("Test Creator");
    expect(reel.handle).toBe("testcreator");
    expect(reel.hashtags).toEqual(["food", "recipe"]);
  });

  it("repairs mojibake in caption", () => {
    // Include a mangled shrimp emoji in the caption
    const reel = normalizeReel(makeEntry({ caption: "Spicy shrimp \u00f0\u009f\u00a6\u0090 salad" }));
    expect(reel.caption).toBe("Spicy shrimp 🦐 salad");
  });

  it("repairs mojibake in creator name", () => {
    const reel = normalizeReel(makeEntry({ ownerName: "Natalia G\u00c3\u00bctierrez" }));
    expect(reel.creator).toBe("Natalia Gütierrez");
  });

  it("converts unix timestamp to Date", () => {
    const reel = normalizeReel(makeEntry({ timestamp: 1780104131 }));
    expect(reel.savedAt).toBeInstanceOf(Date);
    expect(reel.savedAt.getTime()).toBe(1780104131 * 1000);
  });

  it("defaults availableTier to caption", () => {
    const reel = normalizeReel(makeEntry({}));
    expect(reel.availableTier).toBe("caption");
  });

  it("handles missing caption gracefully", () => {
    const reel = normalizeReel(makeEntry({ caption: "" }));
    expect(reel.caption).toBe("");
  });

  it("handles missing hashtags gracefully", () => {
    const reel = normalizeReel(makeEntry({ hashtags: [] }));
    expect(reel.hashtags).toEqual([]);
  });
});
