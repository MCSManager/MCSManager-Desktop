import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import en from "../../i18n/locales/en.json";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge, type MockBridge } from "../../test/mockBridge";

function renderApp(mock: MockBridge) {
  return render(<App bridge={mock} />);
}

describe("dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServicesStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders both service cards", () => {
    renderApp(createMockBridge());
    expect(screen.getByRole("heading", { name: en["service.daemon.name"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: en["service.panel.name"] })).toBeInTheDocument();
  });

  it("status badge maps states", async () => {
    const mock = createMockBridge();
    renderApp(mock);
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
    renderApp(mock);
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
    const user = userEvent.setup();
    const mock = createMockBridge();
    renderApp(mock);
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
    renderApp(mock);
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
    renderApp(mock);
    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "error", pid: 42, exitCode: 3 });
    });
    const card = screen.getByTestId("service-card-daemon");
    expect(within(card).getByText(en["status.pid"].replace("{pid}", "42"))).toBeInTheDocument();
    expect(
      within(card).getByText(en["status.exitCode"].replace("{exitCode}", "3")),
    ).toBeInTheDocument();
  });
});
