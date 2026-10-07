import type { AppConfig, ConfigResponse } from "../types";

export interface ConfigState {
  config: AppConfig | null;
  warnings: string[];
  pathIssues: string[];
}

export interface ConfigStore {
  getState(): ConfigState;
  subscribe(cb: () => void): () => void;
  applyLoaded(response: ConfigResponse): void;
}

export function createConfigStore(): ConfigStore {
  let state: ConfigState = { config: null, warnings: [], pathIssues: [] };
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState(): ConfigState {
      return state;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    applyLoaded(response: ConfigResponse): void {
      state = {
        config: response.config,
        warnings: response.warnings,
        pathIssues: response.pathIssues ?? [],
      };
      notify();
    },
  };
}

let sharedStore: ConfigStore | null = null;

export function getConfigStore(): ConfigStore {
  if (!sharedStore) {
    sharedStore = createConfigStore();
  }
  return sharedStore;
}

export function resetConfigStore(): void {
  sharedStore = null;
}
