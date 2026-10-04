import { useCallback, useEffect, useState } from "react";
import { useBridge } from "../services/bridge";
import type { AppConfig } from "../types";

export interface UseConfigResult {
  config: AppConfig | null;
  warnings: string[];
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
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await bridge.getConfig();
      setConfig(response.config);
      setWarnings(response.warnings);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;
    void bridge.getConfig().then(
      (response) => {
        if (!cancelled) {
          setConfig(response.config);
          setWarnings(response.warnings);
          setError(null);
        }
      },
      (loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bridge]);

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

  return { config, warnings, saving, error, save, reload };
}
