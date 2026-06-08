import { describe, it, expect } from "vitest";
import { isUsefulRecipeComment } from "./comment-quality.ts";

describe("isUsefulRecipeComment", () => {
  it("rejects audio lines", () => {
    expect(
      isUsefulRecipeComment("Mix: Band • Song (Instrumental) | Other • Song"),
    ).toBe(false);
  });

  it("accepts ingredient lists", () => {
    expect(
      isUsefulRecipeComment(
        "INGREDIENTS: 2 cups flour, 1 tsp salt. Bake 25 min at 350F.",
      ),
    ).toBe(true);
  });
});
