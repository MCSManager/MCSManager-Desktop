import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import { BrowserTab, type BrowserTabProps } from "./BrowserTab";

function renderTab(overrides: Partial<BrowserTabProps> = {}) {
  const onStart = overrides.onStart ?? vi.fn();
  const onShowConsole = overrides.onShowConsole ?? vi.fn();
  const props: BrowserTabProps = {
    url: "http://localhost:23333",
    phase: "ready",
    errorMessage: null,
    ...overrides,
    onStart,
    onShowConsole,
  };
  const view = render(
    <I18nProvider initialLanguage="en">
      <BrowserTab {...props} />
    </I18nProvider>,
  );
  return { ...view, onStart, onShowConsole };
}

describe("browser", () => {
  afterEach(() => {
    cleanup();
  });

  it("browser_tab_renders_configured_url", () => {
    renderTab({ url: "http://localhost:23333", phase: "ready" });
    const frame = screen.getByTitle(en["tab.panel"]);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "http://localhost:23333?__mcsmanager_app=1");
  });

  it("browser_tab_keeps_existing_query_when_marking_app_mode", () => {
    renderTab({ url: "http://localhost:23333/?foo=1", phase: "ready" });
    expect(screen.getByTitle(en["tab.panel"])).toHaveAttribute(
      "src",
      "http://localhost:23333/?foo=1&__mcsmanager_app=1",
    );
  });

  it("browser_tab_shows_loading_skeleton_while_booting", () => {
    renderTab({ phase: "booting" });
    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();
    expect(screen.getByText(en["browser.starting.hint"])).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
  });

  it("browser_tab_shows_loading_skeleton_while_settling", () => {
    renderTab({ phase: "settling" });
    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
  });

  it("browser_tab_shows_overlay_when_down", () => {
    renderTab({ phase: "idle" });
    expect(screen.getByText(en["browser.notRunning.title"])).toBeInTheDocument();
    expect(screen.getByText(en["browser.notRunning.hint"])).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
  });

  it("browser_tab_shows_startup_error_with_actions", async () => {
    const user = userEvent.setup();
    const view = renderTab({ phase: "failed", errorMessage: "spawn failed: node" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(en["browser.startupFailed.title"])).toBeInTheDocument();
    expect(screen.getByText(en["browser.startupFailed.hint"])).toBeInTheDocument();
    expect(screen.getByText("spawn failed: node")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: en["browser.startupFailed.openConsole"] }));
    expect(view.onShowConsole).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: en["browser.startupFailed.retry"] }));
    expect(view.onStart).toHaveBeenCalledTimes(1);
  });

  it("browser_tab_hides_error_detail_without_message", () => {
    renderTab({ phase: "failed", errorMessage: null });
    expect(screen.getByText(en["browser.startupFailed.title"])).toBeInTheDocument();
    expect(screen.queryByText(en["browser.startupFailed.detailLabel"])).not.toBeInTheDocument();
  });

  it("browser_tab_hides_address_bar_and_refresh", () => {
    renderTab({ url: "http://localhost:23333", phase: "ready" });
    expect(screen.queryByText("http://localhost:23333")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["browser.refresh"] })).not.toBeInTheDocument();
  });

  it("browser_tab_defers_open_external_to_topbar", () => {
    renderTab({ phase: "ready" });
    expect(
      screen.queryByRole("button", { name: en["browser.openExternal"] }),
    ).not.toBeInTheDocument();
  });

  it("start button calls onStart", async () => {
    const user = userEvent.setup();
    const view = renderTab({ phase: "idle" });
    await user.click(screen.getByRole("button", { name: en["action.start"] }));
    expect(view.onStart).toHaveBeenCalledTimes(1);
  });

  it("browser_tab_hides_readiness_badge", () => {
    renderTab({ phase: "ready" });
    expect(screen.queryByText(en["status.ready"])).not.toBeInTheDocument();
    expect(screen.queryByText(en["status.notReady"])).not.toBeInTheDocument();
  });
});
