import { useState } from "react";
import { useI18n } from "../../i18n";
import type { ServiceState } from "../../types";
import { Icon } from "../layout/Icon";

export interface BrowserTabProps {
  url: string;
  ready: boolean | null;
  serviceState: ServiceState;
  onStartPanel: () => void;
  onOpenExternal: () => void;
}

export function BrowserTab({
  url,
  ready,
  serviceState,
  onStartPanel,
  onOpenExternal,
}: BrowserTabProps) {
  const { t } = useI18n();
  const [refreshNonce, setRefreshNonce] = useState(0);

  return (
    <section className="browser">
      <div className="browser-toolbar">
        <span className="browser-url">{url}</span>
        {ready !== null ? (
          <span
            className={`badge ${ready ? "badge--ready" : "badge--not-ready"}`}
            data-ready={ready ? "true" : "false"}
          >
            {ready ? t("status.ready") : t("status.notReady")}
          </span>
        ) : null}
        <button
          type="button"
          className="browser-btn"
          onClick={() => setRefreshNonce((nonce) => nonce + 1)}
        >
          <Icon name="refresh" />
          <span>{t("browser.refresh")}</span>
        </button>
        <button type="button" className="browser-btn" onClick={onOpenExternal}>
          <Icon name="external" />
          <span>{t("browser.openExternal")}</span>
        </button>
      </div>
      <div className="browser-content">
        {serviceState === "running" ? (
          <iframe
            className="browser-frame"
            title={t("tab.panel")}
            src={url}
            key={refreshNonce}
            data-refresh={refreshNonce}
          />
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
