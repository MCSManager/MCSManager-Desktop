import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import App from "../../App";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { resetConfigStore } from "../../state/configStore";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge, type MockBridge } from "../../test/mockBridge";
import type { AppConfig } from "../../types";

function renderApp(mock: MockBridge, settleDelayMs = 0) {
  return render(<App bridge={mock} settleDelayMs={settleDelayMs} />);
}

async function renderReadyApp(mock: MockBridge, settleDelayMs = 0) {
  const view = renderApp(mock, settleDelayMs);
  await act(async () => {});
  return view;
}

async function openConsole(user: UserEvent) {
  await user.click(screen.getByRole("tab", { name: en["tab.dashboard"] }));
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

  it("auto-starts all services on launch", async () => {
    const mock = createMockBridge();
    renderApp(mock);
    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "startAll", args: [] });
    });
    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();
  });

  it("opens the panel web page once startup completes", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock);
    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
    });

    await waitFor(() => {
      expect(screen.getByTitle(en["tab.panel"])).toBeInTheDocument();
    });
    const frame = screen.getByTitle(en["tab.panel"]);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", mock.config.panelUrl);
  });

  it("waits for the settle delay before entering the web page", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock, 400);

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
    });

    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByTitle(en["tab.panel"])).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows startup error and jumps to the console tab", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitStatus({
        id: "daemon",
        state: "error",
        exitCode: 1,
        error: "process exited with code 1",
      });
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(en["browser.startupFailed.title"])).toBeInTheDocument();
    expect(screen.getByText("process exited with code 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: en["browser.startupFailed.openConsole"] }));
    expect(screen.getByTestId("service-card-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("service-card-panel")).toBeInTheDocument();
  });

  it("shows startup error when the launch command fails", async () => {
    const mock = createMockBridge({
      startAll: () => Promise.reject(new Error('failed to spawn "node"')),
    });
    renderApp(mock);

    await waitFor(() => {
      expect(screen.getByText(en["browser.startupFailed.title"])).toBeInTheDocument();
    });
    expect(screen.getByText('failed to spawn "node"')).toBeInTheDocument();
  });

  it("shows startup error when the daemon reports a service error", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitError({ id: "daemon", message: "service directory missing" });
    });

    expect(screen.getByText(en["browser.startupFailed.title"])).toBeInTheDocument();
    expect(screen.getByText("service directory missing")).toBeInTheDocument();
  });

  it("browser overlay start shortcut boots all services", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
    });
    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "stopped" });
      mock.emitStatus({ id: "panel", state: "stopped" });
    });

    await waitFor(() => {
      expect(screen.getByText(en["browser.notRunning.title"])).toBeInTheDocument();
    });

    const before = mock.calls.filter((call) => call.name === "startAll").length;
    await user.click(screen.getByRole("button", { name: en["action.start"] }));
    await waitFor(() => {
      expect(mock.calls.filter((call) => call.name === "startAll")).toHaveLength(before + 1);
    });
  });

  it("topbar toggles between start all and stop all", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock);

    expect(screen.getByRole("button", { name: en["action.startAll"] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["action.stopAll"] })).not.toBeInTheDocument();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
    });

    expect(screen.getByRole("button", { name: en["action.stopAll"] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["action.startAll"] })).not.toBeInTheDocument();
  });

  it("start-all flow streams both services", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "startAll", args: [] });
    });

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 101, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 202, startedAt: 1700000000000 });
      mock.emitOutput({ id: "daemon", stream: "stdout", line: "daemon listening", timestamp: 1 });
      mock.emitOutput({ id: "panel", stream: "stdout", line: "panel listening", timestamp: 2 });
    });

    await openConsole(user);
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
    await openConsole(user);

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
    expect(screen.getByRole("tab", { name: zh["tab.dashboard"] })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: zh["tab.panel"] })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: zh["tab.dashboard"] }));
    expect(screen.getByRole("heading", { name: zh["service.daemon.name"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: zh["service.panel.name"] })).toBeInTheDocument();
  });

  it("tabs switch between console and panel", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 23332, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });
    await waitFor(() => {
      expect(screen.getByTitle(en["tab.panel"])).toBeInTheDocument();
    });

    await openConsole(user);
    expect(screen.getByTestId("service-card-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("service-card-panel")).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    expect(screen.getByTitle(en["tab.panel"])).toBeInTheDocument();
  });

  it("app keeps probing panel readiness", async () => {
    const mock = createMockBridge();
    await renderReadyApp(mock);
    await act(async () => {
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });

    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "probeTcp", args: ["127.0.0.1", 23333, 1000] });
    });
    expect(screen.queryByText(en["status.ready"])).not.toBeInTheDocument();
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
      mock.emitStatus({ id: "daemon", state: "running", pid: 23332, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 23333, startedAt: 1700000000000 });
    });
    await waitFor(() => {
      expect(screen.getByTitle(en["tab.panel"])).toHaveAttribute("src", "http://127.0.0.1:30000");
    });
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
    const user = userEvent.setup();
    const mock = createMockBridge();
    await renderReadyApp(mock);
    await openConsole(user);

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
    const user = userEvent.setup();
    const mock = createMockBridge();
    mock.config.maxLogLines = 5;
    await renderReadyApp(mock);
    await openConsole(user);

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
