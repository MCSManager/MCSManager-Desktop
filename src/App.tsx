import { useState } from "react";
import { I18nProvider } from "./i18n";
import { Dashboard } from "./components/dashboard/Dashboard";
import { TopBar } from "./components/layout/TopBar";
import type { TabId } from "./components/layout/TabBar";
import { useServices } from "./hooks/useServices";
import { BridgeProvider, bridge as realBridge, type Bridge } from "./services/bridge";

function AppShell() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { statuses, startAll, stopAll } = useServices();
  const busy = Object.values(statuses).some(
    (status) => status.state === "starting" || status.state === "stopping",
  );

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
        {tab === "dashboard" ? <Dashboard /> : <div data-testid="browser-placeholder" />}
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
