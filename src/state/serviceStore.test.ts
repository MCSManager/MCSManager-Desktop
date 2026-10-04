import { describe, it, expect } from "vitest";
import { createServicesStore } from "./serviceStore";

describe("serviceStore", () => {
  it("applyOutput writes into per-service buffer", () => {
    const store = createServicesStore(10);
    store.applyOutput({ id: "daemon", stream: "stdout", line: "hello", timestamp: 1 });
    store.applyOutput({ id: "daemon", stream: "stderr", line: "oops", timestamp: 2 });
    const lines = store.getState().outputs["daemon"];
    expect(lines.map((line) => line.text)).toEqual(["hello", "oops"]);
    expect(lines.map((line) => line.stream)).toEqual(["stdout", "stderr"]);
    expect(lines.map((line) => line.id)).toEqual([1, 2]);
  });

  it("applyStatus upserts status map", () => {
    const store = createServicesStore(10);
    store.applyStatus({ id: "panel", state: "running", pid: 7 });
    store.applyStatus({ id: "panel", state: "stopped", exitCode: 0 });
    const first = store.getState();
    expect(Object.keys(first.statuses)).toEqual(["panel"]);
    expect(first.statuses["panel"].state).toBe("stopped");
    expect(first.statuses["panel"].exitCode).toBe(0);
    expect(first.statuses["panel"].pid).toBeUndefined();
    expect(store.getState()).toBe(first);
    store.applyStatus({ id: "panel", state: "error", error: "boom" });
    expect(store.getState()).not.toBe(first);
    expect(store.getState().statuses["panel"].state).toBe("error");
  });

  it("applyError appends synthetic stderr line", () => {
    const store = createServicesStore(10);
    store.applyOutput({ id: "daemon", stream: "stdout", line: "before", timestamp: 1 });
    store.applyError({ id: "daemon", message: "boom" });
    const lines = store.getState().outputs["daemon"];
    expect(lines).toHaveLength(2);
    expect(lines[1].stream).toBe("stderr");
    expect(lines[1].text).toBe("boom");
  });

  it("buffers are independent per service", () => {
    const store = createServicesStore(10);
    store.applyOutput({ id: "daemon", stream: "stdout", line: "d1", timestamp: 1 });
    store.applyOutput({ id: "panel", stream: "stdout", line: "p1", timestamp: 2 });
    store.applyStatus({ id: "daemon", state: "running" });
    store.clearOutput("daemon");
    const state = store.getState();
    expect(state.outputs["daemon"]).toEqual([]);
    expect(state.outputs["panel"].map((line) => line.text)).toEqual(["p1"]);
    expect(state.statuses["daemon"].state).toBe("running");
    expect(state.statuses["panel"]).toBeUndefined();
  });
});
