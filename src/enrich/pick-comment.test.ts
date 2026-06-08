import { describe, it, expect } from "vitest";
import { pickBestComment } from "./pick-comment.ts";

describe("pickBestComment", () => {
  it("prefers pinned owner comment with recipe signals", () => {
    const best = pickBestComment(
      [
        { text: "So good!", source: "top" },
        {
          text: "INGREDIENTS: 2 cups flour, 1 tsp salt. Mix and bake at 350F for 25 min.",
          source: "owner",
          author: "chef_jane",
          isPinned: true,
        },
      ],
      "chef_jane",
    );
    expect(best?.source).toBe("owner");
    expect(best?.text).toContain("INGREDIENTS");
  });

  it("rejects very short non-recipe comments", () => {
    const best = pickBestComment(
      [{ text: "Nice!", source: "top" }],
      "someone",
    );
    expect(best).toBeNull();
  });

  it("accepts short text with recipe keywords", () => {
    const best = pickBestComment(
      [{ text: "Full recipe in link — ingredients below", source: "top" }],
      "chef",
    );
    expect(best).not.toBeNull();
  });
});
