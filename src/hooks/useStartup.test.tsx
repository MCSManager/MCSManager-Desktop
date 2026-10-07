import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { BridgeProvider } from "../services/bridge";
import { START_CANCELLED } from "../services/portGate";
import { createMockBridge } from "../test/mockBridge";
import { useStartup, type UseStartupOptions } from "./useStartup";

const requiredIds = ["daemon", "panel"];

function renderStartup(overrides: Partial<UseStartupOptions> = {}) {
  const startAll = vi.fn<() => Promise<string | null>>(() => Promise.resolve(null));
  const props: UseStartupOptions = {
    statuses: {},
    requiredIds,
    webReady: false,
    startAll,
    settleDelayMs: 0,
    ...overrides,
  };
  const bridge = createMockBridge();
  const view = renderHook((options: UseStartupOptions) => useStartup(options), {
    initialProps: props,
    wrapper: ({ children }: { children: ReactNode }) => (
      <BridgeProvider bridge={bridge}>{children}</BridgeProvider>
    ),
  });
  return { ...view, startAll };
}

describe("useStartup", () => {
  afterEach(() => {
    cleanup();
  });

  it("auto-starts services on mount", async () => {
    const { result, startAll } = renderStartup();
    await waitFor(() => {
      expect(startAll).toHaveBeenCalledTimes(1);
    });
    expect(result.current.phase).toBe("booting");
  });

  it("settles to idle when the start is cancelled", async () => {
    const startAll = vi.fn<() => Promise<string | null>>(() => Promise.resolve(START_CANCELLED));
    const { result } = renderStartup({ startAll });

    await waitFor(() => {
      expect(result.current.phase).toBe("idle");
    });
    expect(result.current.error).toBeNull();
  });

  it("skips auto-start and stays idle when blocked", async () => {
    const { result, startAll } = renderStartup({ blocked: true });

    await waitFor(() => {
      expect(result.current.phase).toBe("idle");
    });
    expect(startAll).not.toHaveBeenCalled();
  });
});
