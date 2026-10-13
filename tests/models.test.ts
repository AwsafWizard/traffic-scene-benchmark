import { describe, expect, it, vi } from "vitest";

vi.mock("../src/server/db", () => ({ sql: {} }));
vi.mock("../src/server/storage", () => ({ imageBytes: vi.fn() }));

const { buildPrompt, geminiBody, openAIBody, openAIText, parseLetter, parseRequestOptions } = await import("../src/server/models");
const { decryptSecret, encryptSecret } = await import("../src/server/secrets");

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

describe("request options", () => {
  it("accepts an object and rejects anything that could replace the prompt", () => {
    expect(parseRequestOptions("")).toEqual({ ok: true, value: null });
    expect(parseRequestOptions('{"reasoning_effort":"high"}')).toEqual({ ok: true, value: { reasoning_effort: "high" } });
    expect(parseRequestOptions("[1]").ok).toBe(false);
    expect(parseRequestOptions("{oops").ok).toBe(false);
    expect(parseRequestOptions('{"messages":[]}').ok).toBe(false);
    expect(parseRequestOptions('{"model":"other"}').ok).toBe(false);
  });

  it("merges options into the request without letting them override the model or the image", () => {
    const image = { data: "AAAA", type: "image/jpeg" };
    const body = openAIBody("real-model", "Q?", image, { temperature: 0, reasoning_effort: "high" });
    expect(body).toMatchObject({ model: "real-model", temperature: 0, reasoning_effort: "high" });
    expect(body.messages[0].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    const gemini = geminiBody("Q?", image, { generationConfig: { temperature: 0 } });
    expect(gemini.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "AAAA" } });
    expect(gemini).toMatchObject({ generationConfig: { temperature: 0 } });
  });

  it("reads replies whose content is a string or a list of parts", () => {
    expect(openAIText({ choices: [{ message: { content: "B" } }] })).toBe("B");
    expect(openAIText({ choices: [{ message: { content: [{ text: "Answer:" }, { text: "C" }] } }] })).toBe("Answer:\nC");
    expect(openAIText({})).toBe("");
  });
});

describe("stored API keys", () => {
  it("round-trips, differs every time, and fails under the wrong key", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const a = encryptSecret("sk-test-123");
    const b = encryptSecret("sk-test-123");
    expect(a).not.toBe(b);
    expect(a).not.toContain("sk-test");
    expect(decryptSecret(a)).toBe("sk-test-123");
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(() => decryptSecret(a)).toThrow();
  });
});
