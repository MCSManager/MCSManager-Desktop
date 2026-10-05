import { useI18n } from "../../i18n";
import type { ServiceState } from "../../types";
import { Icon } from "../layout/Icon";

export interface BrowserTabProps {
  url: string;
  ready: boolean | null;
  serviceState: ServiceState;
  onStartPanel: () => void;
}

export function BrowserTab({ url, serviceState, onStartPanel }: BrowserTabProps) {
  const { t } = useI18n();

  return (
    <section className="browser">
      <div className="browser-content">
        {serviceState === "running" ? (
          <iframe className="browser-frame" title={t("tab.panel")} src={url} />
        ) : (
          <div className="browser-overlay">
            <h2 className="browser-overlay-title">{t("browser.notRunning.title")}</h2>
            <p className="browser-overlay-hint">{t("browser.notRunning.hint")}</p>
            <button type="button" className="browser-start" onClick={onStartPanel}>
              <Icon name="play" />
              <span>{t("action.start")}</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
