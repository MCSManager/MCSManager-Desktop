import { useEffect, useState } from "react";
import { useI18n, type Language } from "../../i18n";
import { useBridge } from "../../services/bridge";
import type { AppConfig, AppInfo, ServiceConfig, ServiceId } from "../../types";
import { ServiceSettingsForm } from "./ServiceSettingsForm";

export interface SettingsModalProps {
  open: boolean;
  config: AppConfig | null;
  warnings: string[];
  saving: boolean;
  error: string | null;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
}

interface SettingsModalFormProps {
  config: AppConfig;
  info: AppInfo | null;
  warnings: string[];
  saving: boolean;
  error: string | null;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
}

function SettingsModalForm({
  config,
  info,
  warnings,
  saving,
  error,
  onSave,
  onClose,
}: SettingsModalFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const [saved, setSaved] = useState(false);

  const setGeneral = (patch: Partial<AppConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const setService = (id: ServiceId, service: ServiceConfig) => {
    setDraft((current) => ({ ...current, services: { ...current.services, [id]: service } }));
  };

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
  };

  return (
    <div className="settings-overlay" data-testid="settings-modal">
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
      >
        <header className="settings-head">
          <h2 className="settings-title">{t("settings.title")}</h2>
        </header>
        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">{t("settings.general")}</h3>
            <label className="settings-field">
              <span className="settings-label">{t("settings.language")}</span>
              <select
                className="settings-select"
                value={draft.language}
                onChange={(event) => setGeneral({ language: event.target.value as Language })}
              >
                <option value="en">{t("language.en")}</option>
                <option value="zh">{t("language.zh")}</option>
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-label">{t("settings.nodePath")}</span>
              <input
                className="settings-input"
                type="text"
                value={draft.nodePath}
                onChange={(event) => setGeneral({ nodePath: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-label">{t("settings.panelUrl")}</span>
              <input
                className="settings-input"
                type="text"
                value={draft.panelUrl}
                onChange={(event) => setGeneral({ panelUrl: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-label">{t("settings.stopTimeout")}</span>
              <input
                className="settings-input"
                type="number"
                value={draft.stopTimeoutMs}
                onChange={(event) => setGeneral({ stopTimeoutMs: Number(event.target.value) })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-label">{t("settings.maxLogLines")}</span>
              <input
                className="settings-input"
                type="number"
                value={draft.maxLogLines}
                onChange={(event) => setGeneral({ maxLogLines: Number(event.target.value) })}
              />
            </label>
          </section>
          <section className="settings-section">
            <h3 className="settings-section-title">{t("settings.services")}</h3>
            <ServiceSettingsForm
              serviceId="daemon"
              value={draft.services.daemon}
              onChange={(service) => setService("daemon", service)}
            />
            <ServiceSettingsForm
              serviceId="panel"
              value={draft.services.panel}
              onChange={(service) => setService("panel", service)}
            />
          </section>
          <section className="settings-section">
            <h3 className="settings-section-title">{t("settings.about")}</h3>
            <div className="settings-about">
              {info ? (
                <>
                  <span className="settings-about-version">{info.version}</span>
                  <span>
                    {t("settings.configPath")}: <span>{info.configPath}</span>
                  </span>
                </>
              ) : null}
            </div>
          </section>
        </div>
        <footer className="settings-foot">
          <div className="settings-status">
            {saved && error === null ? (
              <p className="settings-saved">{t("settings.saved")}</p>
            ) : null}
            {error !== null ? (
              <div className="settings-error" role="alert">
                <p>{t("error.saveFailed")}</p>
                <p>{error}</p>
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <ul className="settings-warnings">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={handleSave}
            disabled={saving}
          >
            {t("settings.save")}
          </button>
          <button type="button" className="settings-btn" onClick={onClose}>
            {t("settings.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SettingsModal({
  open,
  config,
  warnings,
  saving,
  error,
  onSave,
  onClose,
}: SettingsModalProps) {
  const bridge = useBridge();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void bridge.getAppInfo().then(
      (appInfo) => {
        if (!cancelled) {
          setInfo(appInfo);
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [bridge, open]);

  if (!open || !config) {
    return null;
  }

  return (
    <SettingsModalForm
      config={config}
      info={info}
      warnings={warnings}
      saving={saving}
      error={error}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
