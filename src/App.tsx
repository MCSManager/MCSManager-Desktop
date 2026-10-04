import { useState } from "react";
import { I18nProvider } from "./i18n";
import { BrowserTab } from "./components/browser/BrowserTab";
import { Dashboard } from "./components/dashboard/Dashboard";
import { TopBar } from "./components/layout/TopBar";
import type { TabId } from "./components/layout/TabBar";
import { useConfig } from "./hooks/useConfig";
import { useServices } from "./hooks/useServices";
import { openExternal } from "./services/openExternal";
import { BridgeProvider, bridge as realBridge, type Bridge } from "./services/bridge";

const DEFAULT_PANEL_URL = "http://localhost:23333";

function AppShell() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { statuses, start, startAll, stopAll } = useServices();
  const { config } = useConfig();
  const busy = Object.values(statuses).some(
    (status) => status.state === "starting" || status.state === "stopping",
  );
  const panelUrl = config?.panelUrl ?? DEFAULT_PANEL_URL;

  return (
    <div className="app-shell">
      <TopBar
        activeTab={tab}
        onTabChange={setTab}
        onStartAll={() => void startAll()}
        onStopAll={() => void stopAll()}
        onOpenSettings={() => setSettingsOpen(true)}
        busy={busy}
      />
      <main className="app-main">
        {tab === "dashboard" ? (
          <Dashboard />
        ) : (
          <BrowserTab
            url={panelUrl}
            ready={null}
            serviceState={statuses["panel"]?.state ?? "stopped"}
            onStartPanel={() => void start("panel")}
            onOpenExternal={() => void openExternal(panelUrl).catch(() => {})}
          />
        )}
      </main>
      {settingsOpen ? <div data-testid="settings-placeholder" /> : null}
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
