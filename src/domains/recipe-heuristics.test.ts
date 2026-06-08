import { describe, it, expect } from "vitest";
import type { Reel } from "../ports.ts";
import { hasRecipeSignal } from "./recipe.ts";

const reel = (caption: string): Reel => ({
  url: "https://www.instagram.com/reel/x/",
  reelId: "x",
  creator: "",
  handle: "chef",
  savedAt: new Date(),
  caption,
  hashtags: [],
  availableTier: "caption",
});

describe("hasRecipeSignal", () => {
  it("detects comment-recipe teasers without measurements", () => {
    expect(
      hasRecipeSignal(
        reel("ADOBO CHICKEN\n\nComment RECIPE or visit site.com/recipes"),
      ),
    ).toBe(true);
  });

  it("detects inline ingredients", () => {
    expect(hasRecipeSignal(reel("Salad\n• 2 cups rice\n• 1 tbsp oil"))).toBe(
      true,
    );
  });
});
