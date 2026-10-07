import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgeProvider, type Bridge } from "../services/bridge";
import { PortGuardProvider } from "../services/portGuard";
import { I18nProvider } from "../i18n";
import en from "../i18n/locales/en.json";
import { resetServicesStore } from "../state/serviceStore";
import { createMockBridge } from "../test/mockBridge";
import type { ServiceStatus } from "../types";
import { useServices } from "./useServices";

function wrapperFor(bridge: Bridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <I18nProvider initialLanguage="en">
          <PortGuardProvider>
            <BridgeProvider bridge={bridge}>{children}</BridgeProvider>
          </PortGuardProvider>
        </I18nProvider>
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

  it("resetServicesStore rewires a fresh mount after a leaked one", async () => {
    const leaked = createMockBridge();
    const leakedView = renderHook(() => useServices(), { wrapper: wrapperFor(leaked) });
    await act(async () => {});

    resetServicesStore();

    const fresh = createMockBridge();
    const { result, unmount } = renderHook(() => useServices(), { wrapper: wrapperFor(fresh) });
    await act(async () => {});

    act(() => {
      fresh.emitStatus({ id: "panel", state: "running", pid: 9 });
    });
    expect(result.current.statuses["panel"]?.state).toBe("running");

    leakedView.unmount();
    act(() => {
      fresh.emitStatus({ id: "panel", state: "stopped" });
    });
    expect(result.current.statuses["panel"]?.state).toBe("stopped");
    unmount();
  });

  it("frees an occupied port after confirmation before starting", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const mock = createMockBridge({
      checkStartConflict: vi.fn((id: string) => Promise.resolve(id === "daemon" ? 24444 : null)),
      forceFreePort: vi.fn((port: number) => {
        order.push(`free:${port}`);
        return Promise.resolve();
      }),
      startService: vi.fn((id: string) => {
        order.push(`start:${id}`);
        return Promise.resolve();
      }),
    });
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    let pending: Promise<string | null> | undefined;
    act(() => {
      pending = result.current.start("daemon");
    });

    await waitFor(() => {
      expect(screen.getByTestId("port-conflict-dialog")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: en["portConflict.confirm"] }));
    await act(async () => {
      await pending;
    });

    expect(order).toEqual(["free:24444", "start:daemon"]);
    expect(result.current.actionError).toBeNull();
  });

  it("aborts the start when the port conflict is cancelled", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge({
      checkStartConflict: vi.fn(() => Promise.resolve(24444)),
    });
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(mock) });
    await act(async () => {});

    let pending: Promise<string | null> | undefined;
    act(() => {
      pending = result.current.start("daemon");
    });

    await waitFor(() => {
      expect(screen.getByTestId("port-conflict-dialog")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: en["portConflict.cancel"] }));
    await act(async () => {
      await pending;
    });

    expect(mock.calls.some((call) => call.name === "forceFreePort")).toBe(false);
    expect(mock.calls.some((call) => call.name === "startService")).toBe(false);
    expect(result.current.actionError).toBeNull();
  });
});
