import type { OutputStream } from "../types";

export interface ConsoleLine {
  id: number;
  stream: OutputStream;
  text: string;
  timestamp: number;
}

export function appendLine(
  state: ConsoleLine[],
  entry: { stream: OutputStream; text: string; timestamp: number },
  maxLines: number,
): ConsoleLine[] {
  const id = (state[state.length - 1]?.id ?? 0) + 1;
  const next: ConsoleLine[] = [
    ...state,
    { id, stream: entry.stream, text: entry.text, timestamp: entry.timestamp },
  ];
  return next.length > maxLines ? next.slice(next.length - maxLines) : next;
}

export function clearLines(): ConsoleLine[] {
  return [];
}
