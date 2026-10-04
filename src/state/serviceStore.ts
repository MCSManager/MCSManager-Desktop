import type { OutputLine, ServiceStatus } from "../types";
import { resetBridgeWiring } from "./bridgeWiring";
import { appendLine, clearLines, type ConsoleLine } from "./consoleBuffer";

export interface ServicesState {
  statuses: Record<string, ServiceStatus>;
  outputs: Record<string, ConsoleLine[]>;
}

export interface ServicesStore {
  getState(): ServicesState;
  subscribe(cb: () => void): () => void;
  applyStatus(s: ServiceStatus): void;
  applyOutput(o: OutputLine): void;
  applyError(e: { id: string; message: string }): void;
  clearOutput(id: string): void;
  setMaxLines(next: number): void;
}

export function createServicesStore(maxLines: number): ServicesStore {
  let limit = maxLines;
  let state: ServicesState = { statuses: {}, outputs: {} };
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState(): ServicesState {
      return state;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    applyStatus(s: ServiceStatus): void {
      state = { ...state, statuses: { ...state.statuses, [s.id]: s } };
      notify();
    },
    applyOutput(o: OutputLine): void {
      state = {
        ...state,
        outputs: {
          ...state.outputs,
          [o.id]: appendLine(
            state.outputs[o.id] ?? [],
            { stream: o.stream, text: o.line, timestamp: o.timestamp },
            limit,
          ),
        },
      };
      notify();
    },
    applyError(e: { id: string; message: string }): void {
      state = {
        ...state,
        outputs: {
          ...state.outputs,
          [e.id]: appendLine(
            state.outputs[e.id] ?? [],
            { stream: "stderr", text: e.message, timestamp: Date.now() },
            limit,
          ),
        },
      };
      notify();
    },
    clearOutput(id: string): void {
      state = { ...state, outputs: { ...state.outputs, [id]: clearLines() } };
      notify();
    },
    setMaxLines(next: number): void {
      if (next === limit) {
        return;
      }
      limit = next;
      let trimmed = false;
      const outputs: Record<string, ConsoleLine[]> = {};
      for (const [id, lines] of Object.entries(state.outputs)) {
        if (lines.length > next) {
          outputs[id] = lines.slice(lines.length - next);
          trimmed = true;
        } else {
          outputs[id] = lines;
        }
      }
      if (trimmed) {
        state = { ...state, outputs };
        notify();
      }
    },
  };
}

let sharedStore: ServicesStore | null = null;

export function getServicesStore(maxLines = 2000): ServicesStore {
  if (!sharedStore) {
    sharedStore = createServicesStore(maxLines);
  }
  return sharedStore;
}

export function resetServicesStore(): void {
  resetBridgeWiring();
  sharedStore = null;
}
