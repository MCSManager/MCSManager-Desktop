import { describe, it, expect, vi, afterEach } from "vitest";
import { type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { BridgeProvider } from "../services/bridge";
import { createMockBridge, type MockBridge } from "../test/mockBridge";
import { useReadiness } from "./useReadiness";

function wrapperFor(bridge: MockBridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <BridgeProvider bridge={bridge}>{children}</BridgeProvider>;
  };
}

describe("useReadiness", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls probeTcp while enabled", async () => {
    vi.useFakeTimers();
    const probeTcp = vi.fn(() => Promise.resolve(true));
    const mock = createMockBridge({ probeTcp });
    const { result } = renderHook(() => useReadiness("127.0.0.1", 23333, true, 3000), {
      wrapper: wrapperFor(mock),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(probeTcp.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(probeTcp).toHaveBeenCalledWith("127.0.0.1", 23333, 1000);
    expect(result.current).toBe(true);
  });

  it("disabled when port null", async () => {
    vi.useFakeTimers();
    const probeTcp = vi.fn(() => Promise.resolve(true));
    const mock = createMockBridge({ probeTcp });
    const { result } = renderHook(() => useReadiness("127.0.0.1", null, true, 3000), {
      wrapper: wrapperFor(mock),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    expect(probeTcp).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
