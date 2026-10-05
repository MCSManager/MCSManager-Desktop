import { useState } from "react";
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
import { openExternal } from "./services/openExternal";
import { BridgeProvider, bridge as realBridge, type Bridge } from "./services/bridge";

const DEFAULT_PANEL_URL = "http://localhost:23333";
const HOST = "127.0.0.1";

function AppShell() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { config, warnings, saving, error, save } = useConfig();
  const { statuses, start, startAll, stopAll } = useServices(config?.maxLogLines ?? 2000);
  const busy = Object.values(statuses).some(
    (status) => status.state === "starting" || status.state === "stopping",
  );
  const panelUrl = config?.panelUrl ?? DEFAULT_PANEL_URL;
  const panelState = statuses["panel"]?.state ?? "stopped";
  const panelPort = config?.services.panel.readyPort ?? null;
  const panelReady = useReadiness(HOST, panelPort, panelState === "running");

  return (
    <div className="app-shell">
      <TopBar
        activeTab={tab}
        onTabChange={setTab}
        onStartAll={() => void startAll()}
        onStopAll={() => void stopAll()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenExternal={() => void openExternal(panelUrl).catch(() => {})}
        busy={busy}
      />
      <main className="app-main">
        {tab === "dashboard" ? (
          <Dashboard />
        ) : (
          <BrowserTab
            url={panelUrl}
            ready={panelState === "running" && panelPort != null ? panelReady : null}
            serviceState={panelState}
            onStartPanel={() => void start("panel")}
          />
        )}
      </main>
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

export default function App({ bridge: injected }: { bridge?: Bridge }) {
  return (
    <BridgeProvider bridge={injected ?? realBridge}>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </BridgeProvider>
  );
}
