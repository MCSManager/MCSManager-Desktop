import { describe, it, expect } from "vitest";
import { appendLine, clearLines, type ConsoleLine } from "./consoleBuffer";

describe("consoleBuffer", () => {
  it("appendLine_respects_max_and_keeps_tail", () => {
    let state: ConsoleLine[] = [];
    for (let i = 1; i <= 5; i += 1) {
      state = appendLine(state, { stream: "stdout", text: `line-${i}`, timestamp: i }, 3);
    }
    expect(state.map((line) => line.text)).toEqual(["line-3", "line-4", "line-5"]);
    expect(state.map((line) => line.id)).toEqual([3, 4, 5]);
  });

  it("appendLine tags stream", () => {
    const state = appendLine([], { stream: "stderr", text: "oops", timestamp: 7 }, 10);
    expect(state).toHaveLength(1);
    expect(state[0].stream).toBe("stderr");
    expect(state[0].text).toBe("oops");
    expect(state[0].timestamp).toBe(7);
    expect(state[0].id).toBe(1);
  });

  it("clearLines empties", () => {
    const state = appendLine([], { stream: "stdout", text: "x", timestamp: 1 }, 10);
    const cleared = clearLines();
    expect(cleared).toEqual([]);
    expect(state).toHaveLength(1);
  });
});
