import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/server/db", () => ({ sql: {} }));
vi.mock("../src/server/storage", () => ({ imageBytes: vi.fn() }));

const { buildPrompt, parseLetter } = await import("../src/server/models");

const order = ["c", "a", "b"];

describe("parseLetter", () => {
  it("maps the letter back through the shuffled order", () => {
    expect(parseLetter("B", order)).toBe("a");
    expect(parseLetter("A.", order)).toBe("c");
    expect(parseLetter("(C)", order)).toBe("b");
  });
  it("finds an answer stated in a sentence", () => {
    expect(parseLetter("The answer is B because the van is parked.", order)).toBe("a");
    expect(parseLetter("Looking closely at the scene...\n\nAnswer: C", order)).toBe("b");
  });
  it("ignores letters beyond the option count and gives up when unsure", () => {
    expect(parseLetter("D", order)).toBeNull();
    expect(parseLetter("I can't tell.", order)).toBeNull();
  });
});

describe("buildPrompt", () => {
  it("letters options in the given order", () => {
    const text = buildPrompt("How many?", [{ id: "a", text: "1" }, { id: "b", text: "2" }, { id: "c", text: "3" }], order);
    expect(text).toContain("A. 3\nB. 1\nC. 2");
  });
});
