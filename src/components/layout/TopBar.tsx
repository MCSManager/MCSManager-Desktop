import { useI18n } from "../../i18n";
import { Icon } from "./Icon";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { TabBar, type TabId } from "./TabBar";

export function TopBar({
  activeTab,
  onTabChange,
  onStartAll,
  onStopAll,
  onOpenSettings,
  onOpenExternal,
  busy,
  hasActiveServices,
}: {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onOpenSettings: () => void;
  onOpenExternal: () => void;
  busy: boolean;
  hasActiveServices: boolean;
}) {
  const { t, language, setLanguage } = useI18n();
  const tabs: { id: TabId; label: string }[] = [
    { id: "panel", label: t("tab.panel") },
    { id: "dashboard", label: t("tab.dashboard") },
  ];

  return (
    <footer className="topbar">
      <div className="topbar-nav">
        <TabBar tabs={tabs} active={activeTab} onChange={onTabChange} />
        {activeTab === "panel" ? (
          <button type="button" className="topbar-btn" onClick={onOpenExternal}>
            <Icon name="external" />
            <span>{t("browser.openExternal")}</span>
          </button>
        ) : null}
      </div>
      <div className="topbar-actions">

        {hasActiveServices ? (
          <button
            type="button"
            className="topbar-btn topbar-btn--stop"
            onClick={onStopAll}
            disabled={busy}
          >
            <Icon name="stop" />
            <span>{t("action.stopAll")}</span>
          </button>
        ) : (
          <button
            type="button"
            className="topbar-btn topbar-btn--start"
            onClick={onStartAll}
            disabled={busy}
          >
            <Icon name="play" />
            <span>{t("action.startAll")}</span>
          </button>
        )}
        <LanguageSwitcher language={language} onChange={setLanguage} />
        <button
          type="button"
          className="topbar-btn topbar-btn--icon"
          onClick={onOpenSettings}
          aria-label={t("settings.title")}
        >
          <Icon name="settings" />
        </button>
      </div>
    </footer>
  );
}
