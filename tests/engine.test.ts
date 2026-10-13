import { describe, expect, it } from "vitest";
import { checkComplete, decide, needsJudgment, shuffled, type CheckFacts, type QuestionFacts } from "../src/server/engine";

const q = (verifiability: QuestionFacts["verifiability"]): QuestionFacts => ({ verifiability, correct_option: "a" });
const check = (partial: Partial<CheckFacts>): CheckFacts => ({ role: null, blind_choice: null, judgment: null, ...partial });

describe("V: one checker", () => {
  it("waits for the blind answer", () => {
    expect(decide(q("V"), [check({ role: "v" })])).toEqual({ state: "pending" });
  });
  it("accepts a match with no second step", () => {
    const c = check({ role: "v", blind_choice: "a" });
    expect(needsJudgment(q("V"), c)).toBe(false);
    expect(decide(q("V"), [c])).toEqual({ state: "accepted", resolution: "agreed" });
  });
  it("asks for a judgment on a mismatch, including none and can't tell", () => {
    for (const choice of ["b", "none", "cant_tell"]) {
      const c = check({ role: "v", blind_choice: choice });
      expect(needsJudgment(q("V"), c)).toBe(true);
      expect(decide(q("V"), [c])).toEqual({ state: "pending" });
    }
  });
  it("flags a confirmed setter mistake", () => {
    const c = check({ role: "v", blind_choice: "b", judgment: "setter_mistake" });
    expect(decide(q("V"), [c])).toEqual({ state: "flagged", reason: "setter_mistake" });
  });
  it("accepts when the checker says they misread", () => {
    const c = check({ role: "v", blind_choice: "b", judgment: "misread" });
    expect(decide(q("V"), [c])).toEqual({ state: "accepted", resolution: "misread" });
  });
});

describe("C: two blind checkers", () => {
  it("waits for both", () => {
    expect(decide(q("C"), [check({ role: "c", blind_choice: "a" }), check({ role: "c" })])).toEqual({ state: "pending" });
    expect(decide(q("C"), [check({ role: "c", blind_choice: "a" })])).toEqual({ state: "pending" });
  });
  it("accepts only when all three match", () => {
    const both = [check({ role: "c", blind_choice: "a" }), check({ role: "c", blind_choice: "a" })];
    expect(decide(q("C"), both)).toEqual({ state: "accepted", resolution: "agreed" });
  });
  it("flags any mismatch, including the two checkers agreeing against the setter", () => {
    expect(decide(q("C"), [check({ role: "c", blind_choice: "a" }), check({ role: "c", blind_choice: "b" })]).state).toBe("flagged");
    expect(decide(q("C"), [check({ role: "c", blind_choice: "b" }), check({ role: "c", blind_choice: "b" })]).state).toBe("flagged");
    expect(decide(q("C"), [check({ role: "c", blind_choice: "a" }), check({ role: "c", blind_choice: "none" })]).state).toBe("flagged");
  });
  it("never has a second step", () => {
    expect(needsJudgment(q("C"), check({ role: "c", blind_choice: "b" }))).toBe(false);
  });
});

describe("I: two checkers in turn", () => {
  it("always has a second step after the blind answer", () => {
    expect(needsJudgment(q("I"), check({ role: "second", blind_choice: "a" }))).toBe(true);
    expect(checkComplete(q("I"), check({ role: "second", blind_choice: "a" }))).toBe(false);
    expect(checkComplete(q("I"), check({ role: "second", blind_choice: "a", judgment: "agree" }))).toBe(true);
  });
  it("waits until both have judged", () => {
    const second = check({ role: "second", blind_choice: "b", judgment: "agree" });
    const third = check({ role: "third", blind_choice: "a" });
    expect(decide(q("I"), [second, third])).toEqual({ state: "pending" });
  });
  it("accepts when second agrees and third says all agree, even if blind picks differed", () => {
    const second = check({ role: "second", blind_choice: "b", judgment: "agree" });
    const third = check({ role: "third", blind_choice: "a", judgment: "all_agree" });
    expect(decide(q("I"), [third, second])).toEqual({ state: "accepted", resolution: "agreed" });
  });
  it("flags if either says no", () => {
    expect(
      decide(q("I"), [
        check({ role: "second", blind_choice: "a", judgment: "disagree" }),
        check({ role: "third", blind_choice: "a", judgment: "all_agree" }),
      ]),
    ).toEqual({ state: "flagged", reason: "second_disagreed" });
    expect(
      decide(q("I"), [
        check({ role: "second", blind_choice: "a", judgment: "agree" }),
        check({ role: "third", blind_choice: "b", judgment: "not_all_agree" }),
      ]),
    ).toEqual({ state: "flagged", reason: "third_disagreed" });
  });
});

describe("shuffled", () => {
  it("keeps every item exactly once", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < 50; i++) expect(shuffled(items).sort()).toEqual(items);
  });
  it("puts every item in every position over many draws", () => {
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 2000; i++) {
      shuffled(["a", "b", "c", "d"]).forEach((item, position) => {
        if (!seen.has(item)) seen.set(item, new Set());
        seen.get(item)!.add(position);
      });
    }
    for (const positions of seen.values()) expect(positions.size).toBe(4);
  });
});
