import { createContext, createElement, useContext, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppConfig,
  AppInfo,
  ConfigResponse,
  OutputLine,
  ServiceState,
  ServiceStatus,
} from "../types";

interface WireServiceStatus {
  id: string;
  state: ServiceState;
  pid?: number | null;
  startedAt?: number | null;
  exitCode?: number | null;
  error?: string | null;
}

function normalizeStatus(raw: WireServiceStatus): ServiceStatus {
  const status: ServiceStatus = { id: raw.id, state: raw.state };
  if (raw.pid != null) {
    status.pid = raw.pid;
  }
  if (raw.startedAt != null) {
    status.startedAt = raw.startedAt;
  }
  if (raw.exitCode != null) {
    status.exitCode = raw.exitCode;
  }
  if (raw.error != null) {
    status.error = raw.error;
  }
  return status;
}

function listenTo<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let done = false;
  void listen<T>(event, (e) => cb(e.payload))
    .then((fn) => {
      if (done) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch(() => {});
  return () => {
    done = true;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  };
}

export interface Bridge {
  getConfig(): Promise<ConfigResponse>;
  saveConfig(config: AppConfig): Promise<void>;
  getStatuses(): Promise<ServiceStatus[]>;
  startService(id: string): Promise<void>;
  stopService(id: string): Promise<void>;
  restartService(id: string): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean>;
  getAppInfo(): Promise<AppInfo>;
  onStatus(cb: (s: ServiceStatus) => void): () => void;
  onOutput(cb: (o: OutputLine) => void): () => void;
  onError(cb: (e: { id: string; message: string }) => void): () => void;
}

export const bridge: Bridge = {
  getConfig: () => invoke<ConfigResponse>("get_config"),
  saveConfig: (config) => invoke<void>("save_config", { config }),
  getStatuses: () =>
    invoke<WireServiceStatus[]>("get_service_statuses").then((list) => list.map(normalizeStatus)),
  startService: (id) => invoke<void>("start_service", { id }),
  stopService: (id) => invoke<void>("stop_service", { id }),
  restartService: (id) => invoke<void>("restart_service", { id }),
  startAll: () => invoke<void>("start_all_services"),
  stopAll: () => invoke<void>("stop_all_services"),
  probeTcp: (host, port, timeoutMs) => invoke<boolean>("probe_tcp", { host, port, timeoutMs }),
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  onStatus: (cb) =>
    listenTo("service-status", (raw: WireServiceStatus) => cb(normalizeStatus(raw))),
  onOutput: (cb) => listenTo<OutputLine>("service-output", cb),
  onError: (cb) => listenTo("service-error", cb),
};

const BridgeContext = createContext<Bridge | null>(null);

export function BridgeProvider({
  bridge: value,
  children,
}: {
  bridge: Bridge;
  children: ReactNode;
}) {
  return createElement(BridgeContext.Provider, { value }, children);
}

export function useBridge(): Bridge {
  const context = useContext(BridgeContext);
  if (!context) {
    throw new Error("useBridge must be used within a BridgeProvider");
  }
  return context;
}
