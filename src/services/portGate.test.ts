import { describe, it, expect, vi } from "vitest";
import { ensurePortsFree, START_CANCELLED } from "./portGate";

describe("ensurePortsFree", () => {
  it("passes through when no configured port is occupied", async () => {
    const checkStartConflict = vi.fn<(id: string) => Promise<number | null>>(() =>
      Promise.resolve(null),
    );
    const forceFreePort = vi.fn<(port: number) => Promise<void>>(() => Promise.resolve());
    const confirm = vi.fn<(port: number) => Promise<boolean>>(() => Promise.resolve(true));

    const result = await ensurePortsFree({ checkStartConflict, forceFreePort }, confirm, [
      "daemon",
      "panel",
    ]);

    expect(result).toBe("ok");
    expect(checkStartConflict.mock.calls).toEqual([["daemon"], ["panel"]]);
    expect(confirm).not.toHaveBeenCalled();
    expect(forceFreePort).not.toHaveBeenCalled();
  });

  it("frees the port after the user confirms", async () => {
    const checkStartConflict = vi.fn<(id: string) => Promise<number | null>>((id) =>
      Promise.resolve(id === "panel" ? 23333 : null),
    );
    const forceFreePort = vi.fn<(port: number) => Promise<void>>(() => Promise.resolve());
    const confirm = vi.fn<(port: number) => Promise<boolean>>(() => Promise.resolve(true));

    const result = await ensurePortsFree({ checkStartConflict, forceFreePort }, confirm, [
      "daemon",
      "panel",
    ]);

    expect(result).toBe("ok");
    expect(confirm.mock.calls).toEqual([[23333]]);
    expect(forceFreePort.mock.calls).toEqual([[23333]]);
  });

  it("cancels without killing when the user declines", async () => {
    const checkStartConflict = vi.fn<(id: string) => Promise<number | null>>(() =>
      Promise.resolve(24444),
    );
    const forceFreePort = vi.fn<(port: number) => Promise<void>>(() => Promise.resolve());
    const confirm = vi.fn<(port: number) => Promise<boolean>>(() => Promise.resolve(false));

    const result = await ensurePortsFree({ checkStartConflict, forceFreePort }, confirm, [
      "daemon",
      "panel",
    ]);

    expect(result).toBe("cancelled");
    expect(confirm.mock.calls).toEqual([[24444]]);
    expect(forceFreePort).not.toHaveBeenCalled();
    expect(checkStartConflict.mock.calls).toEqual([["daemon"]]);
  });

  it("exposes a cancel sentinel for the startup flow", () => {
    expect(START_CANCELLED).toBe("start-cancelled");
  });
});
