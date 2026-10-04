import type { Language } from "./i18n";

export type { Language };

export type ServiceId = "daemon" | "panel";

export type ServiceState = "stopped" | "starting" | "running" | "stopping" | "error";

export type OutputStream = "stdout" | "stderr";

export interface ServiceStatus {
  id: string;
  state: ServiceState;
  pid?: number;
  startedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface OutputLine {
  id: string;
  stream: OutputStream;
  line: string;
  timestamp: number;
}

export interface ServiceConfig {
  enabled: boolean;
  workingDir: string;
  script: string;
  extraArgs: string[];
  startDelayMs: number;
  readyPort: number | null;
}

export interface AppConfig {
  version: number;
  language: Language;
  nodePath: string;
  panelUrl: string;
  stopTimeoutMs: number;
  maxLogLines: number;
  services: Record<ServiceId, ServiceConfig>;
}

export interface ConfigResponse {
  config: AppConfig;
  warnings: string[];
}

export interface AppInfo {
  version: string;
  configPath: string;
}
