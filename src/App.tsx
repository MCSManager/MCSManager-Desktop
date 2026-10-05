import { useMemo, useState } from "react";
import { I18nProvider } from "./i18n";
import { BrowserTab } from "./components/browser/BrowserTab";
import { Dashboard } from "./components/dashboard/Dashboard";
import { ContextMenu } from "./components/layout/ContextMenu";
import { TopBar } from "./components/layout/TopBar";
import type { TabId } from "./components/layout/TabBar";
import { SettingsModal } from "./components/settings/SettingsModal";
import { useConfig } from "./hooks/useConfig";
import { useReadiness } from "./hooks/useReadiness";
import { useServices } from "./hooks/useServices";
import { useStartup, DEFAULT_SETTLE_DELAY_MS } from "./hooks/useStartup";
import { openExternal } from "./services/openExternal";
import { BridgeProvider, bridge as realBridge, type Bridge } from "./services/bridge";

const DEFAULT_PANEL_URL = "http://localhost:23333";
const HOST = "127.0.0.1";

function AppShell({ settleDelayMs }: { settleDelayMs?: number }) {
  const [tab, setTab] = useState<TabId>("panel");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { config, warnings, saving, error, save } = useConfig();
  const { statuses, startAll, stopAll } = useServices(config?.maxLogLines ?? 2000);
  const busy = Object.values(statuses).some(
    (status) => status.state === "starting" || status.state === "stopping",
  );
  const hasActiveServices = Object.values(statuses).some(
    (status) =>
      status.state === "starting" || status.state === "running" || status.state === "stopping",
  );
  const panelUrl = config?.panelUrl ?? DEFAULT_PANEL_URL;
  const panelEnabled = config?.services.panel.enabled !== false;
  const panelState = statuses["panel"]?.state ?? "stopped";
  const panelPort = config?.services.panel.readyPort ?? null;
  const panelReady = useReadiness(HOST, panelPort, panelState === "running");
  const webReady = panelPort == null || panelReady;

  const requiredIds = useMemo(
    () => (["daemon", "panel"] as const).filter((id) => config?.services[id].enabled !== false),
    [config],
  );

  const startup = useStartup({
    statuses,
    requiredIds,
    webReady,
    startAll,
    settleDelayMs: settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS,
  });
  const panelPhase = panelEnabled ? startup.phase : "idle";

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === "dashboard" ? (
          <Dashboard />
        ) : (
          <BrowserTab
            url={panelUrl}
            phase={panelPhase}
            errorMessage={startup.error}
            onStart={startup.start}
            onShowConsole={() => setTab("dashboard")}
          />
        )}
      </main>
      <TopBar
        activeTab={tab}
        onTabChange={setTab}
        onStartAll={startup.start}
        onStopAll={() => void stopAll()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenExternal={() => void openExternal(panelUrl).catch(() => {})}
        busy={busy}
        hasActiveServices={hasActiveServices}
      />
      <SettingsModal
        open={settingsOpen}
        config={config}
        warnings={warnings}
        saving={saving}
        error={error}
        onSave={save}
        onClose={() => setSettingsOpen(false)}
      />
      <ContextMenu />
    </div>
  );
}

export default function App({
  bridge: injected,
  settleDelayMs,
}: {
  bridge?: Bridge;
  settleDelayMs?: number;
}) {
  return (
    <BridgeProvider bridge={injected ?? realBridge}>
      <I18nProvider>
        <AppShell settleDelayMs={settleDelayMs} />
      </I18nProvider>
    </BridgeProvider>
  );
}
