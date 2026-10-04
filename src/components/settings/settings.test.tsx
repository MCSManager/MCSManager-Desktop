import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import { BridgeProvider } from "../../services/bridge";
import { createMockBridge } from "../../test/mockBridge";
import type { AppConfig } from "../../types";
import { SettingsModal, type SettingsModalProps } from "./SettingsModal";

function makeConfig(): AppConfig {
  return {
    version: 1,
    language: "en",
    nodePath: "node",
    panelUrl: "http://localhost:23333",
    stopTimeoutMs: 35000,
    maxLogLines: 2000,
    services: {
      daemon: {
        enabled: true,
        workingDir: "C:/mcsm/daemon",
        script: "app.js",
        extraArgs: [],
        startDelayMs: 0,
        readyPort: 24444,
      },
      panel: {
        enabled: true,
        workingDir: "C:/mcsm/panel",
        script: "app.js",
        extraArgs: [],
        startDelayMs: 1500,
        readyPort: 23333,
      },
    },
  };
}

function renderModal(overrides: Partial<SettingsModalProps> = {}) {
  const onSave = vi.fn<(config: AppConfig) => void>();
  const onClose = vi.fn();
  const props: SettingsModalProps = {
    open: true,
    config: makeConfig(),
    warnings: [],
    saving: false,
    error: null,
    onSave,
    onClose,
    ...overrides,
  };
  render(
    <BridgeProvider bridge={createMockBridge()}>
      <I18nProvider initialLanguage="en">
        <SettingsModal {...props} />
      </I18nProvider>
    </BridgeProvider>,
  );
  return { onSave, onClose };
}

describe("settings modal", () => {
  afterEach(() => {
    cleanup();
  });

  it("edits panel url and saves validated config", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    const input = screen.getByLabelText(en["settings.panelUrl"]);
    await user.clear(input);
    await user.type(input, "http://127.0.0.1:30000");
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      ...makeConfig(),
      panelUrl: "http://127.0.0.1:30000",
    });
    expect(screen.getByText(en["settings.saved"])).toBeInTheDocument();
  });

  it("ready port empty becomes null", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    const input = within(screen.getByTestId("service-settings-panel")).getByLabelText(
      en["settings.readyPort"],
    );
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));
    expect(onSave.mock.calls[0][0].services.panel.readyPort).toBeNull();
  });

  it("extra args comma parsing round-trips", async () => {
    const user = userEvent.setup();
    const config = makeConfig();
    config.services.panel.extraArgs = ["a", "b"];
    const { onSave } = renderModal({ config });
    const input = within(screen.getByTestId("service-settings-panel")).getByLabelText(
      en["settings.extraArgs"],
    );
    expect(input).toHaveValue("a, b");
    await user.clear(input);
    await user.type(input, "a,b");
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));
    expect(onSave.mock.calls[0][0].services.panel.extraArgs).toEqual(["a", "b"]);
  });

  it("shows save error when bridge rejects", () => {
    renderModal({ error: "boom: invalid config" });
    expect(screen.getByText(en["error.saveFailed"])).toBeInTheDocument();
    expect(screen.getByText("boom: invalid config")).toBeInTheDocument();
  });

  it("shows path warnings", () => {
    renderModal({ warnings: ["missing dir"] });
    expect(screen.getByText("missing dir")).toBeInTheDocument();
  });
});
