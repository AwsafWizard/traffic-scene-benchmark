import { describe, expect, it } from "vitest";
import { parseRepo } from "../src/server/hf";

describe("parseRepo", () => {
  it("reads a repo name or a link into it", () => {
    expect(parseRepo("azmain/dhakadrive-videos")).toBe("azmain/dhakadrive-videos");
    expect(parseRepo(" https://huggingface.co/datasets/azmain/dhakadrive-videos ")).toBe("azmain/dhakadrive-videos");
    expect(parseRepo("https://huggingface.co/datasets/azmain/dhakadrive-videos/tree/main/mirpur")).toBe("azmain/dhakadrive-videos");
    expect(parseRepo("https://huggingface.co/datasets/Team.Org/videos_v2/")).toBe("Team.Org/videos_v2");
  });
  it("rejects anything else", () => {
    expect(parseRepo("just-a-name")).toBeNull();
    expect(parseRepo("https://drive.google.com/drive/folders/abc")).toBeNull();
    expect(parseRepo("a/b/c")).toBeNull();
  });
});
