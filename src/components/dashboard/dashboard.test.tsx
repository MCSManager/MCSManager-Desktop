import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import en from "../../i18n/locales/en.json";
import { resetConfigStore } from "../../state/configStore";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge, type MockBridge } from "../../test/mockBridge";

function renderApp(mock: MockBridge) {
  return render(<App bridge={mock} />);
}

async function renderConsoleApp(mock: MockBridge) {
  const user = userEvent.setup();
  const view = renderApp(mock);
  await user.click(screen.getByRole("tab", { name: en["tab.dashboard"] }));
  return { user, ...view };
}

describe("dashboard", () => {
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

  it("renders both service cards", async () => {
    await renderConsoleApp(createMockBridge());
    expect(screen.getByRole("heading", { name: en["service.daemon.name"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: en["service.panel.name"] })).toBeInTheDocument();
  });

  it("status badge maps states", async () => {
    const mock = createMockBridge();
    await renderConsoleApp(mock);
    const card = screen.getByTestId("service-card-daemon");
    const states = ["stopped", "starting", "running", "stopping", "error"] as const;
    for (const state of states) {
      await act(async () => {
        mock.emitStatus({ id: "daemon", state });
      });
      expect(within(card).getByText(en[`state.${state}` as keyof typeof en])).toBeInTheDocument();
    }
  });

  it("console shows streamed lines and respects stderr style", async () => {
    const mock = createMockBridge();
    await renderConsoleApp(mock);
    await act(async () => {
      mock.emitOutput({ id: "daemon", stream: "stdout", line: "boot ok", timestamp: 1 });
      mock.emitOutput({ id: "daemon", stream: "stderr", line: "boom", timestamp: 2 });
    });
    const card = screen.getByTestId("service-card-daemon");
    expect(within(card).getByText("boot ok")).toHaveAttribute("data-stream", "stdout");
    const errLine = within(card).getByText("boom");
    expect(errLine).toHaveAttribute("data-stream", "stderr");
    expect(errLine).toHaveClass("console-line--stderr");
  });

  it("clear empties the console", async () => {
    const mock = createMockBridge();
    const { user } = await renderConsoleApp(mock);
    await act(async () => {
      mock.emitOutput({ id: "daemon", stream: "stdout", line: "hello", timestamp: 1 });
      mock.emitOutput({ id: "panel", stream: "stderr", line: "other", timestamp: 2 });
    });
    const daemonCard = screen.getByTestId("service-card-daemon");
    expect(within(daemonCard).getByText("hello")).toBeInTheDocument();
    await user.click(within(daemonCard).getByRole("button", { name: en["console.clear"] }));
    expect(within(daemonCard).queryByText("hello")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("service-card-panel")).getByText("other")).toBeInTheDocument();
  });

  it("stop button enabled only when running", async () => {
    const mock = createMockBridge();
    await renderConsoleApp(mock);
    const card = screen.getByTestId("service-card-daemon");
    const stopButton = () => within(card).getByRole("button", { name: en["action.stop"] });

    expect(stopButton()).toBeDisabled();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "stopped" });
    });
    expect(stopButton()).toBeDisabled();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "stopping" });
    });
    expect(stopButton()).toBeDisabled();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running" });
    });
    expect(stopButton()).toBeEnabled();
  });

  it("renders pid and exit code", async () => {
    const mock = createMockBridge();
    await renderConsoleApp(mock);
    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "error", pid: 42, exitCode: 3 });
    });
    const card = screen.getByTestId("service-card-daemon");
    expect(within(card).getByText(en["status.pid"].replace("{pid}", "42"))).toBeInTheDocument();
    expect(
      within(card).getByText(en["status.exitCode"].replace("{exitCode}", "3")),
    ).toBeInTheDocument();
  });

  it("start_all_skips_disabled_services", async () => {
    const mock = createMockBridge();
    mock.config.services.daemon.enabled = false;
    const { user } = await renderConsoleApp(mock);
    await act(async () => {});

    const daemonCard = screen.getByTestId("service-card-daemon");
    expect(within(daemonCard).getByText(en["status.disabled"])).toBeInTheDocument();
    expect(within(daemonCard).getByRole("button", { name: en["action.start"] })).toBeDisabled();
    expect(within(daemonCard).getByRole("button", { name: en["action.restart"] })).toBeDisabled();

    const panelCard = screen.getByTestId("service-card-panel");
    expect(within(panelCard).queryByText(en["status.disabled"])).not.toBeInTheDocument();
    expect(within(panelCard).getByRole("button", { name: en["action.start"] })).toBeEnabled();

    const before = mock.calls.filter((call) => call.name === "startAll").length;
    await user.click(screen.getByRole("button", { name: en["action.startAll"] }));
    await waitFor(() => {
      expect(mock.calls.filter((call) => call.name === "startAll")).toHaveLength(before + 1);
    });
    expect(mock.calls).not.toContainEqual({ name: "startService", args: ["daemon"] });
  });
});
