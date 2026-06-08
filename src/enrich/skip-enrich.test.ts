import { describe, it, expect } from "vitest";
import type { Reel } from "../ports.ts";
import { isExternalRecipeOnly, shouldSkipCommentEnrich } from "./skip-enrich.ts";

const base = (caption: string): Reel => ({
  url: "https://www.instagram.com/reel/abc/",
  reelId: "abc",
  creator: "Chef",
  handle: "chef",
  savedAt: new Date(),
  caption,
  hashtags: [],
  availableTier: "caption",
});

describe("isExternalRecipeOnly", () => {
  it("detects comment-recipe + off-platform link without inline recipe", () => {
    const reel = base(
      "ADOBO CHICKEN RICE\n\nComment RECIPE or visit example.com/recipes (link in bio)!",
    );
    expect(isExternalRecipeOnly(reel)).toBe(true);
    expect(shouldSkipCommentEnrich(reel)).toBe(true);
  });

  it("does not skip when ingredients are in the caption", () => {
    const reel = base(
      "Tacos\n\nIngredients:\n• 1 tbsp oil\n• 2 cups flour\n\nComment for more tips",
    );
    expect(isExternalRecipeOnly(reel)).toBe(false);
  });
});
