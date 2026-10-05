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

function StartupSkeleton() {
  const { t } = useI18n();
  return (
    <div className="browser-overlay" role="status" aria-live="polite">
      <div className="startup-skeleton" aria-hidden="true">
        <div className="skeleton-bar skeleton-bar--title" />
        <div className="skeleton-bar" />
        <div className="skeleton-bar" />
        <div className="skeleton-bar skeleton-bar--short" />
      </div>
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

export function BrowserTab({ url, phase, errorMessage, onStart, onShowConsole }: BrowserTabProps) {
  const { t } = useI18n();

  return (
    <section className="browser">
      <div className="browser-content">
        {phase === "ready" ? (
          <iframe className="browser-frame" title={t("tab.panel")} src={url} />
        ) : phase === "failed" ? (
          <StartupFailed
            message={errorMessage ?? null}
            onStart={onStart}
            onShowConsole={onShowConsole}
          />
        ) : phase === "idle" ? (
          <NotRunning onStart={onStart} />
        ) : (
          <StartupSkeleton />
        )}
      </div>
    </section>
  );
}
