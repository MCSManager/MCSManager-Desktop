import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nProvider, useI18n } from "./i18n";
import { BrowserTab } from "./components/browser/BrowserTab";
import { AppDialog } from "./components/dialogs/AppDialog";
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
import { PortGuardProvider } from "./services/portGuard";
import { BridgeProvider, bridge as realBridge, type Bridge } from "./services/bridge";

const DEFAULT_PANEL_URL = "http://localhost:23333";
const HOST = "127.0.0.1";

function AppShell({ settleDelayMs }: { settleDelayMs?: number }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("panel");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missingFilesOpen, setMissingFilesOpen] = useState(false);
  const missingFilesShownRef = useRef(false);
  const { config, warnings, pathIssues, loaded, saving, error, save } = useConfig();
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

  const filesMissing = config != null && pathIssues.length > 0;

  // Surface missing service files (daemon/web or their app.js) exactly once per
  // launch, and never fight the auto-start that `blocked` already suppresses.
  useEffect(() => {
    if (filesMissing && !missingFilesShownRef.current) {
      missingFilesShownRef.current = true;
      setMissingFilesOpen(true);
    }
  }, [filesMissing]);

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
    blocked: filesMissing,
    ready: loaded,
  });
  const panelPhase = panelEnabled ? startup.phase : "idle";
  const showConsole = useCallback(() => setTab("dashboard"), []);

  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="app-pane" hidden={tab !== "dashboard"}>
          <Dashboard />
        </div>
        <div className="app-pane" hidden={tab !== "panel"}>
          <BrowserTab
            url={panelUrl}
            phase={panelPhase}
            errorMessage={startup.error}
            onStart={startup.start}
            onShowConsole={showConsole}
          />
        </div>
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
      {missingFilesOpen ? (
        <AppDialog
          testId="missing-files-dialog"
          title={t("error.missingFiles.title")}
          message={t("error.missingFiles.message")}
          confirmLabel={t("action.ok")}
          onConfirm={() => setMissingFilesOpen(false)}
        />
      ) : null}
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
        <PortGuardProvider>
          <AppShell settleDelayMs={settleDelayMs} />
        </PortGuardProvider>
      </I18nProvider>
    </BridgeProvider>
  );
}
