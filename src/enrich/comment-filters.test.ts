import { describe, it, expect } from "vitest";
import { isAudioOrReelUiNoise } from "./comment-filters.ts";

describe("isAudioOrReelUiNoise", () => {
  it("flags reel audio attribution lines", () => {
    expect(
      isAudioOrReelUiNoise(
        "Mix: Guitar Tribute Players • Baila Esta Cumbia (Instrumental) | Selena • Baila Esta Cumbia",
      ),
    ).toBe(true);
    expect(isAudioOrReelUiNoise("Eliott Tordo Erhu•To Love's End (Inuyasha)")).toBe(true);
    expect(isAudioOrReelUiNoise("Original audio")).toBe(true);
  });

  it("allows recipe-like comments", () => {
    expect(
      isAudioOrReelUiNoise(
        "INGREDIENTS: 2 cups flour, 1 tsp salt. Bake at 350F for 25 minutes.",
      ),
    ).toBe(false);
    expect(
      isAudioOrReelUiNoise("Full recipe with 2 tbsp oil and steps in the thread below."),
    ).toBe(false);
  });
});
