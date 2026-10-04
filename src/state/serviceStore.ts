import type { OutputLine, ServiceStatus } from "../types";
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
}

export function createServicesStore(maxLines: number): ServicesStore {
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
            maxLines,
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
            maxLines,
          ),
        },
      };
      notify();
    },
    clearOutput(id: string): void {
      state = { ...state, outputs: { ...state.outputs, [id]: clearLines() } };
      notify();
    },
  };
}
