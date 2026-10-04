import { describe, it, expect } from "vitest";
import { containsCjk } from "./cjk";

describe("containsCjk", () => {
  it("detects Chinese characters", () => {
    expect(containsCjk("\u542f\u52a8\u9762\u677f")).toBe(true);
    expect(containsCjk("start \u9762\u677f")).toBe(true);
  });
  it("passes English and symbols", () => {
    expect(containsCjk("Start panel")).toBe(false);
    expect(containsCjk("\\u4e00 escaped")).toBe(false);
    expect(containsCjk("")).toBe(false);
  });
});
