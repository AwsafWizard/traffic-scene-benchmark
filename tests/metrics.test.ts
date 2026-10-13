import { describe, expect, it } from "vitest";
import { fleissKappa, pairwiseAgreement } from "../src/server/metrics";

describe("fleissKappa", () => {
  it("matches the worked example from Fleiss (1971) as reproduced on Wikipedia", () => {
    // 10 subjects, 14 raters, 5 categories; expected kappa ≈ 0.210.
    const table = [
      [0, 0, 0, 0, 14],
      [0, 2, 6, 4, 2],
      [0, 0, 3, 5, 6],
      [0, 3, 9, 2, 0],
      [2, 2, 8, 1, 1],
      [7, 7, 0, 0, 0],
      [3, 2, 6, 3, 0],
      [2, 5, 3, 2, 2],
      [6, 5, 2, 1, 0],
      [0, 2, 2, 3, 7],
    ];
    const items = table.map((row) => row.flatMap((count, category) => Array(count).fill(String(category))));
    expect(fleissKappa(items)).toBeCloseTo(0.21, 2);
  });

  it("is 1 for perfect agreement across varied categories", () => {
    expect(fleissKappa([["a", "a", "a"], ["b", "b", "b"], ["c", "c", "c"]])).toBeCloseTo(1, 10);
  });

  it("is null when it can't be computed", () => {
    expect(fleissKappa([["a", "a", "a"]])).toBeNull();
    expect(fleissKappa([["a", "a"], ["a", "a"]])).toBeNull();
  });
});

describe("pairwiseAgreement", () => {
  it("pools agreeing pairs over all items", () => {
    // item 1: 3 pairs all agree; item 2: a,a,b -> 1 of 3 pairs agree
    expect(pairwiseAgreement([["a", "a", "a"], ["a", "a", "b"]])).toBeCloseTo(4 / 6);
  });
});
