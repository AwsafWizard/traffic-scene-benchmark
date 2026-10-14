import { describe, expect, it } from "vitest";
import { drawCheckers, type DrawTopic } from "../src/server/draw";

const topic = (assignmentId: number, authorId: string, subtypeIds: number[], loadPerChecker = 10): DrawTopic => ({
  assignmentId,
  authorId,
  subtypeIds,
  loadPerChecker,
});

describe("drawCheckers", () => {
  it("never picks someone who wrote in the topic", () => {
    const topics = [topic(1, "a", [1]), topic(2, "b", [2]), topic(3, "c", [3])];
    for (let i = 0; i < 100; i++) {
      const result = drawCheckers(topics, ["a", "b", "c"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const slot of result.slots) {
        const author = topics.find((t) => t.assignmentId === slot.assignmentId)!.authorId;
        expect(slot.checkerIds).not.toContain(author);
        expect(new Set(slot.checkerIds).size).toBe(2);
      }
    }
  });

  it("excludes people whose own topics overlap, not just the author", () => {
    // b's whole-category topic covers subtype 1, which a also wrote in.
    const topics = [topic(1, "a", [1]), topic(2, "b", [1, 2]), topic(3, "c", [3])];
    const result = drawCheckers(topics, ["a", "b", "c", "d"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const forA = result.slots.find((s) => s.assignmentId === 1)!.checkerIds;
    expect(forA).not.toContain("b");
  });

  it("balances the load when everyone writes the same amount", () => {
    const people = ["a", "b", "c", "d", "e"];
    const topics = people.map((p, i) => topic(i + 1, p, [i + 1], 20));
    const result = drawCheckers(topics, people);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const count = new Map(people.map((p) => [p, 0]));
    for (const slot of result.slots) slot.checkerIds.forEach((c) => count.set(c, count.get(c)! + 1));
    for (const n of count.values()) expect(n).toBe(2);
  });

  it("says which topic can't be covered", () => {
    const result = drawCheckers([topic(7, "a", [1]), topic(8, "b", [1])], ["a", "b", "c"]);
    expect(result).toMatchObject({ ok: false, assignmentId: expect.any(Number) });
  });
});
