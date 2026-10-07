import type { Bridge } from "./bridge";

export type PortGateResult = "ok" | "cancelled";

/// Returned by guarded start actions when the user declines to free a port so
/// the startup flow can settle into an idle state without an error overlay.
export const START_CANCELLED = "start-cancelled";

/// Ensures every service about to start has a free port. For each occupied
/// port the user is asked to confirm terminating the occupying program; on
/// confirmation the port is force-freed, otherwise the whole start is cancelled.
export async function ensurePortsFree(
  bridge: Pick<Bridge, "checkStartConflict" | "forceFreePort">,
  confirm: (port: number) => Promise<boolean>,
  ids: readonly string[],
): Promise<PortGateResult> {
  for (const id of ids) {
    const port = await bridge.checkStartConflict(id);
    if (port == null) {
      continue;
    }
    const confirmed = await confirm(port);
    if (!confirmed) {
      return "cancelled";
    }
    await bridge.forceFreePort(port);
  }
  return "ok";
}
