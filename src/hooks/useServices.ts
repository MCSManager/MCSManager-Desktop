import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useBridge } from "../services/bridge";
import { wireBridge } from "../state/bridgeWiring";
import type { ConsoleLine } from "../state/consoleBuffer";
import { getServicesStore, type ServicesState } from "../state/serviceStore";

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

  const start = useCallback((id: string) => run(() => bridge.startService(id)), [bridge, run]);
  const stop = useCallback((id: string) => run(() => bridge.stopService(id)), [bridge, run]);
  const restart = useCallback((id: string) => run(() => bridge.restartService(id)), [bridge, run]);
  const startAll = useCallback(() => run(() => bridge.startAll()), [bridge, run]);
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
