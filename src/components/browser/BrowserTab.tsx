import { memo } from "react";
import type { PanelPhase } from "../../hooks/useStartup";
import { useI18n } from "../../i18n";
import { Icon } from "../layout/Icon";

export interface BrowserTabProps {
  url: string;
  phase: PanelPhase;
  errorMessage?: string | null;
  onStart: () => void;
  onShowConsole: () => void;
}

const APP_MODE_PARAM = "__mcsmanager_app";

function buildFrameSrc(url: string): string {
  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  if (base.includes(`${APP_MODE_PARAM}=`)) {
    return url;
  }
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${APP_MODE_PARAM}=1${hash}`;
}

function StartupOverlay() {
  const { t } = useI18n();
  return (
    <div className="browser-overlay" role="status" aria-live="polite">
      <div className="startup-spinner" aria-hidden="true" />
      <h2 className="browser-overlay-title">{t("browser.starting.title")}</h2>
      <p className="browser-overlay-hint">{t("browser.starting.hint")}</p>
    </div>
  );
}

function StartupFailed({
  message,
  onStart,
  onShowConsole,
}: {
  message: string | null;
  onStart: () => void;
  onShowConsole: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="browser-overlay" role="alert">
      <div className="startup-error-icon" aria-hidden="true">
        <Icon name="alert" size={26} />
      </div>
      <h2 className="browser-overlay-title">{t("browser.startupFailed.title")}</h2>
      <p className="browser-overlay-hint">{t("browser.startupFailed.hint")}</p>
      {message != null && message !== "" ? (
        <div className="startup-error-detail">
          <span className="startup-error-detail-label">
            {t("browser.startupFailed.detailLabel")}
          </span>
          <span className="startup-error-detail-message">{message}</span>
        </div>
      ) : null}
      <div className="startup-error-actions">
        <button type="button" className="browser-start" onClick={onShowConsole}>
          <Icon name="terminal" />
          <span>{t("browser.startupFailed.openConsole")}</span>
        </button>
        <button type="button" className="browser-retry" onClick={onStart}>
          <Icon name="restart" />
          <span>{t("browser.startupFailed.retry")}</span>
        </button>
      </div>
    </div>
  );
}

function NotRunning({ onStart }: { onStart: () => void }) {
  const { t } = useI18n();
  return (
    <div className="browser-overlay">
      <h2 className="browser-overlay-title">{t("browser.notRunning.title")}</h2>
      <p className="browser-overlay-hint">{t("browser.notRunning.hint")}</p>
      <button type="button" className="browser-start" onClick={onStart}>
        <Icon name="play" />
        <span>{t("action.start")}</span>
      </button>
    </div>
  );
}

export const BrowserTab = memo(function BrowserTab({
  url,
  phase,
  errorMessage,
  onStart,
  onShowConsole,
}: BrowserTabProps) {
  const { t } = useI18n();

  return (
    <section className="browser">
      <div className="browser-content">
        {phase === "ready" ? (
          <iframe className="browser-frame" title={t("tab.panel")} src={buildFrameSrc(url)} />
        ) : phase === "failed" ? (
          <StartupFailed
            message={errorMessage ?? null}
            onStart={onStart}
            onShowConsole={onShowConsole}
          />
        ) : phase === "idle" ? (
          <NotRunning onStart={onStart} />
        ) : (
          <StartupOverlay />
        )}
      </div>
    </section>
  );
});
