import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { BridgeProvider, type Bridge } from "../services/bridge";
import { resetServicesStore } from "../state/serviceStore";
import { createMockBridge } from "../test/mockBridge";
import type { ServiceStatus } from "../types";
import { useServices } from "./useServices";

function wrapperFor(bridge: Bridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <BridgeProvider bridge={bridge}>{children}</BridgeProvider>
      </StrictMode>
    );
  };
}

describe("useServices", () => {
  beforeEach(() => {
    resetServicesStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders status updates from bridge events", async () => {
    const mock = createMockBridge();
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    act(() => {
      mock.emitStatus({ id: "panel", state: "running", pid: 4242, startedAt: 1700000000000 });
      mock.emitOutput({ id: "panel", stream: "stdout", line: "boot", timestamp: 1700000000001 });
      mock.emitError({ id: "panel", message: "boom" });
    });

    expect(result.current.statuses["panel"].state).toBe("running");
    expect(result.current.statuses["panel"].pid).toBe(4242);
    expect(result.current.statuses["panel"].startedAt).toBe(1700000000000);
    const lines = result.current.outputs["panel"];
    expect(lines.map((line) => line.text)).toEqual(["boot", "boom"]);
    expect(lines[1].stream).toBe("stderr");
  });

  it("start calls bridge and reports actionError on reject", async () => {
    const startService = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValue(new Error("spawn failed"));
    const mock = createMockBridge({ startService });
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    await act(async () => {
      await result.current.start("daemon");
    });
    expect(mock.calls).toContainEqual({ name: "startService", args: ["daemon"] });
    expect(result.current.actionError).toBe("spawn failed");

    await act(async () => {
      await result.current.stop("daemon");
    });
    expect(mock.calls).toContainEqual({ name: "stopService", args: ["daemon"] });
    expect(result.current.actionError).toBeNull();
  });

  it("unsubscribes on unmount", async () => {
    const mock = createMockBridge();
    const seen: ServiceStatus[] = [];
    const baseOnStatus = mock.onStatus;
    let active = 0;
    mock.onStatus = (cb) => {
      active += 1;
      const unlisten = baseOnStatus((s) => {
        seen.push(s);
        cb(s);
      });
      return () => {
        active -= 1;
        unlisten();
      };
    };

    const { unmount } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});
    expect(active).toBe(1);

    act(() => {
      mock.emitStatus({ id: "daemon", state: "running" });
    });
    expect(seen).toHaveLength(1);

    unmount();
    expect(active).toBe(0);

    expect(() => {
      mock.emitStatus({ id: "daemon", state: "stopped" });
    }).not.toThrow();
    expect(active).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it("useServices hydrates from getStatuses on mount", async () => {
    const running: ServiceStatus = { id: "hydrate", state: "running", pid: 111 };
    const mock = createMockBridge({
      getStatuses: vi.fn(() => Promise.resolve([running])),
    });
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    expect(mock.calls.some((call) => call.name === "getStatuses")).toBe(true);
    expect(result.current.statuses["hydrate"].state).toBe("running");
    expect(result.current.statuses["hydrate"].pid).toBe(111);

    const failing = createMockBridge({
      getStatuses: vi.fn(() => Promise.reject(new Error("init down"))),
    });
    const failed = renderHook(() => useServices(), { wrapper: wrapperFor(failing) });
    await act(async () => {});
    expect(failed.result.current.actionError).toBeNull();
  });

  it("store is shared across useServices consumers", async () => {
    const mock = createMockBridge();
    const first = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    const second = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    act(() => {
      mock.emitOutput({ id: "shared", stream: "stdout", line: "once", timestamp: 1 });
    });

    const fromFirst = first.result.current.outputs["shared"];
    const fromSecond = second.result.current.outputs["shared"];
    expect(fromFirst).toHaveLength(1);
    expect(fromFirst[0].text).toBe("once");
    expect(fromSecond).toBe(fromFirst);
  });
});
