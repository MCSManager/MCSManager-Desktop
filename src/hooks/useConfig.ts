import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useBridge } from "../services/bridge";
import { getConfigStore } from "../state/configStore";
import type { AppConfig } from "../types";

export interface UseConfigResult {
  config: AppConfig | null;
  warnings: string[];
  pathIssues: string[];
  loaded: boolean;
  saving: boolean;
  error: string | null;
  save: (next: AppConfig) => Promise<void>;
  reload: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useConfig(): UseConfigResult {
  const bridge = useBridge();
  const store = getConfigStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const { config, warnings, pathIssues } = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );

  const reload = useCallback(async () => {
    try {
      const response = await bridge.getConfig();
      store.applyLoaded(response);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [bridge, store]);

  useEffect(() => {
    void bridge.getConfig().then(
      (response) => {
        store.applyLoaded(response);
        setError(null);
        setLoaded(true);
      },
      (loadError: unknown) => {
        setError(errorMessage(loadError));
        setLoaded(true);
      },
    );
  }, [bridge, store]);

  const save = useCallback(
    async (next: AppConfig) => {
      setSaving(true);
      try {
        await bridge.saveConfig(next);
        setError(null);
        await reload();
      } catch (saveError) {
        setError(errorMessage(saveError));
      } finally {
        setSaving(false);
      }
    },
    [bridge, reload],
  );

  return { config, warnings, pathIssues, loaded, saving, error, save, reload };
}
