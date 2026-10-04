import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useServices } from "../../hooks/useServices";
import type { ConsoleLine } from "../../state/consoleBuffer";
import type { ServiceId, ServiceStatus } from "../../types";
import { ActionButton, type ActionKind } from "./ActionButton";
import { ConsolePanel } from "./ConsolePanel";
import { StatusBadge } from "./StatusBadge";

export interface ServiceCardProps {
  serviceId: ServiceId;
  status: ServiceStatus;
  lines: ConsoleLine[];
  ready: boolean | null;
  onAction: (action: ActionKind) => void;
  busy: boolean;
  enabled: boolean;
}

function formatHms(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ServiceCard({
  serviceId,
  status,
  lines,
  ready,
  onAction,
  busy,
  enabled,
}: ServiceCardProps) {
  const { t } = useI18n();
  const { clearOutput } = useServices();
  const { state, pid, startedAt, exitCode } = status;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state !== "running") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const uptime = startedAt != null ? formatHms(now - startedAt) : null;

  const handleCopy = () => {
    const text = lines.map((line) => line.text).join("\n");
    try {
      void navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // Clipboard is unavailable in this environment.
    }
  };

  return (
    <article className="card" data-testid={`service-card-${serviceId}`}>
      <header className="card-head">
        <h2 className="card-title">{t("service." + serviceId + ".name")}</h2>
        <StatusBadge state={state} />
      </header>
      <div className="card-info">
        {pid != null ? <span className="card-info-item">{t("status.pid", { pid })}</span> : null}
        {uptime != null ? (
          <span className="card-info-item">{t("status.uptime", { uptime })}</span>
        ) : null}
        {exitCode != null ? (
          <span className="card-info-item">{t("status.exitCode", { exitCode })}</span>
        ) : null}
        {ready !== null ? (
          <span
            className={`badge ${ready ? "badge--ready" : "badge--not-ready"}`}
            data-ready={ready ? "true" : "false"}
          >
            {ready ? t("status.ready") : t("status.notReady")}
          </span>
        ) : null}
        {enabled ? null : <span className="badge badge--disabled">{t("status.disabled")}</span>}
      </div>
      <div className="card-actions">
        <ActionButton
          kind="start"
          busy={busy}
          disabled={!enabled || state === "running" || state === "starting"}
          onClick={() => onAction("start")}
        />
        <ActionButton
          kind="stop"
          busy={busy}
          disabled={state === "stopped" || state === "stopping"}
          onClick={() => onAction("stop")}
        />
        <ActionButton
          kind="restart"
          busy={busy}
          disabled={!enabled || state !== "running"}
          onClick={() => onAction("restart")}
        />
      </div>
      <ConsolePanel lines={lines} onClear={() => clearOutput(serviceId)} onCopy={handleCopy} />
    </article>
  );
}
