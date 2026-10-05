import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { resetConfigStore } from "../../state/configStore";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge, type MockBridge } from "../../test/mockBridge";
import type { AppConfig } from "../../types";

function renderApp(mock: MockBridge) {
  return render(<App bridge={mock} />);
}

async function renderReadyApp(mock: MockBridge) {
  const view = renderApp(mock);
  await act(async () => {});
  return view;
}

describe("app integration flows", () => {
  beforeEach(() => {
    localStorage.clear();
    resetConfigStore();
    resetServicesStore();
  });

  afterEach(() => {
    cleanup();
    resetConfigStore();
    resetServicesStore();
  });

  it("start-all flow streams both services", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await user.click(screen.getByRole("button", { name: en["action.startAll"] }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "startAll", args: [] });
    });

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
      mock.emitOutput({ id: "daemon", stream: "stdout", line: "daemon listening", timestamp: 1 });
      mock.emitOutput({ id: "panel", stream: "stdout", line: "panel listening", timestamp: 2 });
    });

    const daemonCard = screen.getByTestId("service-card-daemon");
    const panelCard = screen.getByTestId("service-card-panel");
    expect(within(daemonCard).getByText(en["state.running"])).toBeInTheDocument();
    expect(within(panelCard).getByText(en["state.running"])).toBeInTheDocument();
    expect(within(daemonCard).getByText("daemon listening")).toBeInTheDocument();
    expect(within(panelCard).getByText("panel listening")).toBeInTheDocument();
  });

  it("stop flow and unexpected exit show error state", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 31337, startedAt: 1700000000000 });
    });
    const card = screen.getByTestId("service-card-daemon");
    await user.click(within(card).getByRole("button", { name: en["action.stop"] }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "stopService", args: ["daemon"] });
    });

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "error", exitCode: 1, error: "exited unexpectedly" });
    });

    expect(within(card).getByText(en["state.error"])).toBeInTheDocument();
    expect(
      within(card).getByText(en["status.exitCode"].replace("{exitCode}", "1")),
    ).toBeInTheDocument();
  });

  it("language toggle switches entire chrome", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await user.click(screen.getByRole("button", { name: en["language.switcher"] }));
    await user.click(screen.getByRole("menuitemradio", { name: zh["language.zh"] }));

    expect(screen.getByRole("button", { name: zh["action.startAll"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh["action.stopAll"] })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: zh["tab.dashboard"] })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: zh["tab.panel"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: zh["service.daemon.name"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: zh["service.panel.name"] })).toBeInTheDocument();
  });

  it("tabs switch between dashboard and panel", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });

    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));

    const frame = screen.getByTitle(en["tab.panel"]);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", mock.config.panelUrl);

    await user.click(screen.getByRole("tab", { name: en["tab.dashboard"] }));
    expect(screen.getByTestId("service-card-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("service-card-panel")).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
  });

  it("browser overlay start shortcut starts panel", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    expect(screen.getByText(en["browser.notRunning.title"])).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: en["action.start"] }));
    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "startService", args: ["panel"] });
    });
  });

  it("app keeps probing panel readiness", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);
    await act(async () => {
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });

    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    await waitFor(() => {
      expect(screen.queryByText(en["status.ready"])).not.toBeInTheDocument();
    });
    expect(mock.calls).toContainEqual({ name: "probeTcp", args: ["127.0.0.1", 23333, 1000] });
  });

  it("settings round-trip saves through bridge", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await user.click(screen.getByRole("button", { name: en["settings.title"] }));
    const input = screen.getByLabelText(en["settings.panelUrl"]);
    await user.clear(input);
    await user.type(input, "http://127.0.0.1:30000");
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));

    await waitFor(() => {
      expect(
        mock.calls.some(
          (call) =>
            call.name === "saveConfig" &&
            (call.args[0] as AppConfig).panelUrl === "http://127.0.0.1:30000",
        ),
      ).toBe(true);
    });
    expect(mock.config.panelUrl).toBe("http://127.0.0.1:30000");

    await user.click(screen.getByRole("button", { name: en["settings.close"] }));
    expect(screen.queryByTestId("settings-modal")).not.toBeInTheDocument();

    await act(async () => {
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });
    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    expect(screen.getByTitle(en["tab.panel"])).toHaveAttribute("src", "http://127.0.0.1:30000");
  });

  it("config save refreshes all consumers", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);
    await act(async () => {
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });

    await user.click(screen.getByRole("button", { name: en["settings.title"] }));
    const input = within(screen.getByTestId("service-settings-panel")).getByLabelText(
      en["settings.readyPort"],
    );
    await user.clear(input);
    await user.type(input, "25555");
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));

    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "probeTcp", args: ["127.0.0.1", 25555, 1000] });
    });
  });

  it("settings language change takes effect on save", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await user.click(screen.getByRole("button", { name: en["settings.title"] }));
    await user.selectOptions(screen.getByLabelText(en["settings.language"]), "zh");
    await user.click(screen.getByRole("button", { name: en["settings.save"] }));

    expect(screen.getByRole("button", { name: zh["settings.save"] })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: zh["settings.close"] }));
    expect(screen.getByRole("button", { name: zh["action.startAll"] })).toBeInTheDocument();
    expect(localStorage.getItem("mcsm-desktop.lang")).toBe("zh");
    expect(mock.config.language).toBe("zh");
  });

  it("startup language falls back to config when nothing stored", async () => {
    const mock = createMockBridge();
    mock.config.language = "zh";
    await renderReadyApp(mock);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: zh["action.startAll"] })).toBeInTheDocument();
    });
    expect(localStorage.getItem("mcsm-desktop.lang")).toBeNull();
  });

  it("stored language wins over config language", async () => {
    localStorage.setItem("mcsm-desktop.lang", "en");
    const mock = createMockBridge();
    mock.config.language = "zh";
    await renderReadyApp(mock);

    expect(screen.getByRole("button", { name: en["action.startAll"] })).toBeInTheDocument();
  });

  it("console ring cap honored end to end", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      for (let i = 0; i < 2100; i += 1) {
        mock.emitOutput({ id: "daemon", stream: "stdout", line: `line-${i}`, timestamp: i });
      }
    });

    const card = screen.getByTestId("service-card-daemon");
    const rendered = card.querySelectorAll(".console-line");
    expect(rendered.length).toBeLessThanOrEqual(mock.config.maxLogLines);
    expect(within(card).queryByText("line-0")).not.toBeInTheDocument();
    expect(within(card).getByText("line-2099")).toBeInTheDocument();
  });

  it("console ring cap follows configured maxLogLines", async () => {
    const mock = createMockBridge();
    mock.config.maxLogLines = 5;
    await renderReadyApp(mock);

    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        mock.emitOutput({ id: "daemon", stream: "stdout", line: `cap-${i}`, timestamp: i });
      }
    });

    const card = screen.getByTestId("service-card-daemon");
    const rendered = card.querySelectorAll(".console-line");
    expect(rendered.length).toBeLessThanOrEqual(5);
    expect(within(card).getByText("cap-9")).toBeInTheDocument();
  });
});
