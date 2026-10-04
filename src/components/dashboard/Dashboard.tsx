import { useConfig } from "../../hooks/useConfig";
import { useReadiness } from "../../hooks/useReadiness";
import { useServices } from "../../hooks/useServices";
import type { ConsoleLine } from "../../state/consoleBuffer";
import type { ServiceId, ServiceStatus } from "../../types";
import type { ActionKind } from "./ActionButton";
import { ServiceCard } from "./ServiceCard";

const HOST = "127.0.0.1";
const EMPTY_LINES: ConsoleLine[] = [];

function statusOf(statuses: Record<string, ServiceStatus>, id: ServiceId): ServiceStatus {
  return statuses[id] ?? { id, state: "stopped" };
}

function isBusy(status: ServiceStatus): boolean {
  return status.state === "starting" || status.state === "stopping";
}

export function Dashboard() {
  const { statuses, outputs, start, stop, restart, actionError } = useServices();
  const { config } = useConfig();

  const daemonStatus = statusOf(statuses, "daemon");
  const panelStatus = statusOf(statuses, "panel");

  const daemonPort = config?.services.daemon.readyPort ?? null;
  const panelPort = config?.services.panel.readyPort ?? null;
  const daemonRunning = daemonStatus.state === "running";
  const panelRunning = panelStatus.state === "running";
  const daemonReady = useReadiness(HOST, daemonPort, daemonRunning);
  const panelReady = useReadiness(HOST, panelPort, panelRunning);

  const runAction = (id: ServiceId, action: ActionKind) => {
    if (action === "start") {
      void start(id);
    } else if (action === "stop") {
      void stop(id);
    } else {
      void restart(id);
    }
  };

  return (
    <>
      {actionError != null ? (
        <div className="card-banner card-banner--error" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="card-grid">
        <ServiceCard
          serviceId="daemon"
          status={daemonStatus}
          lines={outputs.daemon ?? EMPTY_LINES}
          ready={daemonRunning && daemonPort != null ? daemonReady : null}
          busy={isBusy(daemonStatus)}
          onAction={(action) => runAction("daemon", action)}
        />
        <ServiceCard
          serviceId="panel"
          status={panelStatus}
          lines={outputs.panel ?? EMPTY_LINES}
          ready={panelRunning && panelPort != null ? panelReady : null}
          busy={isBusy(panelStatus)}
          onAction={(action) => runAction("panel", action)}
        />
      </div>
    </>
  );
}
