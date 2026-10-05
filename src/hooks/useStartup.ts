import { useCallback, useEffect, useRef, useState } from "react";
import { useBridge } from "../services/bridge";
import type { ServiceState, ServiceStatus } from "../types";

export type PanelPhase = "booting" | "settling" | "ready" | "failed" | "idle";

export const DEFAULT_SETTLE_DELAY_MS = 2000;
export const DEFAULT_READY_TIMEOUT_MS = 15000;
export const DEFAULT_BOOT_TIMEOUT_MS = 90000;

const STARTING_OR_STOPPING: ServiceState[] = ["starting", "stopping"];

export interface UseStartupOptions {
  statuses: Record<string, ServiceStatus>;
  requiredIds: string[];
  webReady: boolean;
  startAll: () => Promise<string | null>;
  settleDelayMs?: number;
  readyTimeoutMs?: number;
  bootTimeoutMs?: number;
}

export interface UseStartupResult {
  phase: PanelPhase;
  error: string | null;
  start: () => void;
}

export function useStartup({
  statuses,
  requiredIds,
  webReady,
  startAll,
  settleDelayMs = DEFAULT_SETTLE_DELAY_MS,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
}: UseStartupOptions): UseStartupResult {
  const bridge = useBridge();
  const [phase, setPhase] = useState<PanelPhase>("booting");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<PanelPhase>(phase);
  const bootIdRef = useRef(0);
  const managedRef = useRef(true);
  const sawActivityRef = useRef(false);
  const autoStartedRef = useRef(false);
  const prevStatesRef = useRef<Record<string, ServiceState | undefined>>({});

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const fail = useCallback((message: string | null) => {
    const current = phaseRef.current;
    if (current !== "booting" && current !== "settling") {
      return;
    }
    setPhase("failed");
    setError(message);
  }, []);

  const start = useCallback(() => {
    bootIdRef.current += 1;
    managedRef.current = true;
    sawActivityRef.current = false;
    prevStatesRef.current = {};
    setError(null);
    setPhase("booting");
    const bootId = bootIdRef.current;
    void startAll().then((message) => {
      if (message != null && bootIdRef.current === bootId) {
        setPhase("failed");
        setError(message);
      }
    });
  }, [startAll]);

  useEffect(() => {
    if (autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    start();
  }, [start]);

  useEffect(() => bridge.onError((event) => fail(event.message)), [bridge, fail]);

  useEffect(() => {
    const states = requiredIds.map((id) => statuses[id]?.state ?? "stopped");
    const previous = prevStatesRef.current;
    const failingId = requiredIds.find(
      (id, index) =>
        (phaseRef.current === "booting" || phaseRef.current === "settling") &&
        states[index] === "error" &&
        previous[id] !== "error",
    );
    const snapshot: Record<string, ServiceState | undefined> = {};
    requiredIds.forEach((id, index) => {
      snapshot[id] = states[index];
    });
    prevStatesRef.current = snapshot;

    if (failingId != null) {
      setPhase("failed");
      setError(statuses[failingId]?.error ?? null);
      return;
    }

    if (
      states.some((state) => state === "starting" || state === "running" || state === "stopping")
    ) {
      sawActivityRef.current = true;
    }

    const current = phaseRef.current;
    const panelState = statuses["panel"]?.state ?? "stopped";
    const anyInFlight = states.some((state) => STARTING_OR_STOPPING.includes(state));
    const allStopped = requiredIds.length > 0 && states.every((state) => state === "stopped");
    const allRunning = requiredIds.length > 0 && states.every((state) => state === "running");
    const webGate = panelState === "running" && webReady;

    if (current === "booting" || current === "settling") {
      if (webGate && (!managedRef.current || allRunning)) {
        setPhase("settling");
        return;
      }
      const aborted = managedRef.current ? allStopped : panelState === "stopped" && !anyInFlight;
      if (aborted && sawActivityRef.current) {
        managedRef.current = false;
        setPhase("idle");
      }
      return;
    }

    if (current === "ready") {
      if (panelState === "error") {
        setPhase("failed");
        setError(statuses["panel"]?.error ?? null);
        return;
      }
      if (panelState === "stopped") {
        managedRef.current = false;
        setPhase("idle");
      }
      return;
    }

    if (panelState === "starting" || panelState === "running") {
      managedRef.current = false;
      setPhase("booting");
    }
  }, [statuses, requiredIds, webReady]);

  useEffect(() => {
    if (phase !== "settling") {
      return;
    }
    const timer = window.setTimeout(() => setPhase("ready"), settleDelayMs);
    return () => window.clearTimeout(timer);
  }, [phase, settleDelayMs]);

  useEffect(() => {
    if (phase !== "booting") {
      return;
    }
    const panelState = statuses["panel"]?.state ?? "stopped";
    if (panelState !== "running" || webReady) {
      return;
    }
    const timer = window.setTimeout(() => setPhase("settling"), readyTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [phase, statuses, webReady, readyTimeoutMs]);

  useEffect(() => {
    if (phase !== "booting" || !managedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase("failed");
      setError(null);
    }, bootTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [phase, bootTimeoutMs]);

  return { phase, error, start };
}
