import { useState } from "react";
import { useI18n } from "../../i18n";
import type { ServiceConfig, ServiceId } from "../../types";

export interface ServiceSettingsFormProps {
  serviceId: ServiceId;
  value: ServiceConfig;
  onChange: (value: ServiceConfig) => void;
}

function parseExtraArgs(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function ServiceSettingsForm({ serviceId, value, onChange }: ServiceSettingsFormProps) {
  const { t } = useI18n();
  const [extraArgsText, setExtraArgsText] = useState(() => value.extraArgs.join(", "));

  const set = (patch: Partial<ServiceConfig>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="settings-service" data-testid={`service-settings-${serviceId}`}>
      <h4 className="settings-service-title">{t(`service.${serviceId}.name`)}</h4>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
        <span>{t("settings.enabled")}</span>
      </label>
      <label className="settings-field">
        <span className="settings-label">{t("settings.workingDir")}</span>
        <input
          className="settings-input"
          type="text"
          value={value.workingDir}
          onChange={(event) => set({ workingDir: event.target.value })}
        />
      </label>
      <label className="settings-field">
        <span className="settings-label">{t("settings.script")}</span>
        <input
          className="settings-input"
          type="text"
          value={value.script}
          onChange={(event) => set({ script: event.target.value })}
        />
      </label>
      <label className="settings-field">
        <span className="settings-label">{t("settings.extraArgs")}</span>
        <input
          className="settings-input"
          type="text"
          value={extraArgsText}
          onChange={(event) => {
            setExtraArgsText(event.target.value);
            set({ extraArgs: parseExtraArgs(event.target.value) });
          }}
        />
      </label>
      <label className="settings-field">
        <span className="settings-label">{t("settings.startDelay")}</span>
        <input
          className="settings-input"
          type="number"
          value={value.startDelayMs}
          onChange={(event) => set({ startDelayMs: Number(event.target.value) })}
        />
      </label>
      <label className="settings-field">
        <span className="settings-label">{t("settings.readyPort")}</span>
        <input
          className="settings-input"
          type="number"
          value={value.readyPort ?? ""}
          onChange={(event) =>
            set({
              readyPort: event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </label>
    </div>
  );
}
