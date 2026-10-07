import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useBridge } from "../services/bridge";
import { ensurePortsFree, START_CANCELLED } from "../services/portGate";
import { usePortGuard } from "../services/portGuard";
import { wireBridge } from "../state/bridgeWiring";
import { getConfigStore } from "../state/configStore";
import type { ConsoleLine } from "../state/consoleBuffer";
import { getServicesStore, type ServicesState } from "../state/serviceStore";
import type { ServiceId } from "../types";

const START_ORDER: ServiceId[] = ["daemon", "panel"];

// Services that are enabled and currently stopped/errored, i.e. the ones a
// start-all attempt will actually launch (and therefore must port-check).
function startTargets(
  config: { services: Record<ServiceId, { enabled: boolean }> } | null,
  statuses: ServicesState["statuses"],
): ServiceId[] {
  return START_ORDER.filter((id) => {
    const enabled = config?.services[id]?.enabled ?? true;
    const state = statuses[id]?.state ?? "stopped";
    return enabled && (state === "stopped" || state === "error");
  });
}

export interface UseServicesResult {
  statuses: ServicesState["statuses"];
  outputs: Record<string, ConsoleLine[]>;
  start: (id: string) => Promise<string | null>;
  stop: (id: string) => Promise<string | null>;
  restart: (id: string) => Promise<string | null>;
  startAll: () => Promise<string | null>;
  stopAll: () => Promise<string | null>;
  clearOutput: (id: string) => void;
  actionError: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useServices(maxLines?: number): UseServicesResult {
  const bridge = useBridge();
  const store = getServicesStore(maxLines ?? 2000);
  const [actionError, setActionError] = useState<string | null>(null);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const { statuses, outputs } = state;

  useEffect(() => wireBridge(bridge, store), [bridge, store]);

  useEffect(() => {
    if (maxLines !== undefined) {
      store.setMaxLines(maxLines);
    }
  }, [store, maxLines]);

  useEffect(() => {
    void bridge.getStatuses().then(
      (list) => {
        for (const status of list) {
          store.applyStatus(status);
        }
      },
      () => {},
    );
  }, [bridge, store]);

  const run = useCallback(async (action: () => Promise<void>): Promise<string | null> => {
    try {
      await action();
      setActionError(null);
      return null;
    } catch (error) {
      const message = errorMessage(error);
      setActionError(message);
      return message;
    }
  }, []);

  const guard = usePortGuard();

  const ensure = useCallback(
    (ids: readonly string[]) => ensurePortsFree(bridge, guard.confirmPortKill, ids),
    [bridge, guard],
  );

  const start = useCallback(
    (id: string) =>
      run(async () => {
        if ((await ensure([id])) === "cancelled") {
          return;
        }
        await bridge.startService(id);
      }),
    [bridge, run, ensure],
  );
  const stop = useCallback((id: string) => run(() => bridge.stopService(id)), [bridge, run]);
  const restart = useCallback(
    (id: string) =>
      run(async () => {
        if ((await ensure([id])) === "cancelled") {
          return;
        }
        await bridge.restartService(id);
      }),
    [bridge, run, ensure],
  );
  const startAll = useCallback(async (): Promise<string | null> => {
    const config = getConfigStore().getState().config;
    if ((await ensure(startTargets(config, statuses))) === "cancelled") {
      return START_CANCELLED;
    }
    return run(() => bridge.startAll());
  }, [bridge, run, ensure, statuses]);
  const stopAll = useCallback(() => run(() => bridge.stopAll()), [bridge, run]);
  const clearOutput = useCallback((id: string) => store.clearOutput(id), [store]);

  return {
    statuses,
    outputs,
    start,
    stop,
    restart,
    startAll,
    stopAll,
    clearOutput,
    actionError,
  };
}
