import type { Bridge } from "../services/bridge";
import type {
  AppConfig,
  AppInfo,
  ConfigResponse,
  OutputLine,
  ServiceConfig,
  ServiceStatus,
} from "../types";

export interface MockBridge extends Bridge {
  emitStatus(s: ServiceStatus): void;
  emitOutput(o: OutputLine): void;
  emitError(e: { id: string; message: string }): void;
  calls: { name: string; args: unknown[] }[];
  config: AppConfig;
}

function makeService(overrides: Partial<ServiceConfig>): ServiceConfig {
  return {
    enabled: true,
    workingDir: "",
    script: "app.js",
    extraArgs: [],
    startDelayMs: 0,
    readyPort: null,
    ...overrides,
  };
}

function makeDefaultConfig(): AppConfig {
  return {
    version: 1,
    language: "en",
    nodePath: "node",
    panelUrl: "http://localhost:23333",
    stopTimeoutMs: 35000,
    maxLogLines: 2000,
    services: {
      daemon: makeService({ startDelayMs: 0, readyPort: 24444 }),
      panel: makeService({ startDelayMs: 1500, readyPort: 23333 }),
    },
  };
}

export function createMockBridge(overrides?: Partial<Bridge>): MockBridge {
  const calls: { name: string; args: unknown[] }[] = [];
  const statusListeners = new Set<(s: ServiceStatus) => void>();
  const outputListeners = new Set<(o: OutputLine) => void>();
  const errorListeners = new Set<(e: { id: string; message: string }) => void>();

  const mock: MockBridge = {
    config: makeDefaultConfig(),
    calls,
    emitStatus(s) {
      for (const cb of [...statusListeners]) {
        cb(s);
      }
    },
    emitOutput(o) {
      for (const cb of [...outputListeners]) {
        cb(o);
      }
    },
    emitError(e) {
      for (const cb of [...errorListeners]) {
        cb(e);
      }
    },
    async getConfig(): Promise<ConfigResponse> {
      calls.push({ name: "getConfig", args: [] });
      if (overrides?.getConfig) {
        return overrides.getConfig();
      }
      return { config: structuredClone(mock.config), warnings: [] };
    },
    async saveConfig(config: AppConfig): Promise<void> {
      calls.push({ name: "saveConfig", args: [config] });
      if (overrides?.saveConfig) {
        return overrides.saveConfig(config);
      }
      mock.config = structuredClone(config);
    },
    async getStatuses(): Promise<ServiceStatus[]> {
      calls.push({ name: "getStatuses", args: [] });
      if (overrides?.getStatuses) {
        return overrides.getStatuses();
      }
      return [];
    },
    async startService(id: string): Promise<void> {
      calls.push({ name: "startService", args: [id] });
      if (overrides?.startService) {
        return overrides.startService(id);
      }
    },
    async stopService(id: string): Promise<void> {
      calls.push({ name: "stopService", args: [id] });
      if (overrides?.stopService) {
        return overrides.stopService(id);
      }
    },
    async restartService(id: string): Promise<void> {
      calls.push({ name: "restartService", args: [id] });
      if (overrides?.restartService) {
        return overrides.restartService(id);
      }
    },
    async startAll(): Promise<void> {
      calls.push({ name: "startAll", args: [] });
      if (overrides?.startAll) {
        return overrides.startAll();
      }
    },
    async stopAll(): Promise<void> {
      calls.push({ name: "stopAll", args: [] });
      if (overrides?.stopAll) {
        return overrides.stopAll();
      }
    },
    async probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
      calls.push({ name: "probeTcp", args: [host, port, timeoutMs] });
      if (overrides?.probeTcp) {
        return overrides.probeTcp(host, port, timeoutMs);
      }
      return true;
    },
    async getAppInfo(): Promise<AppInfo> {
      calls.push({ name: "getAppInfo", args: [] });
      if (overrides?.getAppInfo) {
        return overrides.getAppInfo();
      }
      return { version: "0.0.0-test", configPath: "test-config.json" };
    },
    onStatus(cb) {
      calls.push({ name: "onStatus", args: [cb] });
      if (overrides?.onStatus) {
        return overrides.onStatus(cb);
      }
      statusListeners.add(cb);
      return () => {
        statusListeners.delete(cb);
      };
    },
    onOutput(cb) {
      calls.push({ name: "onOutput", args: [cb] });
      if (overrides?.onOutput) {
        return overrides.onOutput(cb);
      }
      outputListeners.add(cb);
      return () => {
        outputListeners.delete(cb);
      };
    },
    onError(cb) {
      calls.push({ name: "onError", args: [cb] });
      if (overrides?.onError) {
        return overrides.onError(cb);
      }
      errorListeners.add(cb);
      return () => {
        errorListeners.delete(cb);
      };
    },
  };

  return mock;
}
