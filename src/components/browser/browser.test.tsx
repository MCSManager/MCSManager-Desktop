import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import { BrowserTab, type BrowserTabProps } from "./BrowserTab";

function renderTab(overrides: Partial<BrowserTabProps> = {}) {
  const onStartPanel = overrides.onStartPanel ?? vi.fn();
  const onOpenExternal = overrides.onOpenExternal ?? vi.fn();
  const props: BrowserTabProps = {
    url: "http://localhost:23333",
    ready: null,
    serviceState: "running",
    ...overrides,
    onStartPanel,
    onOpenExternal,
  };
  const view = render(
    <I18nProvider initialLanguage="en">
      <BrowserTab {...props} />
    </I18nProvider>,
  );
  return { ...view, onStartPanel, onOpenExternal };
}

describe("browser", () => {
  afterEach(() => {
    cleanup();
  });

  it("browser_tab_renders_configured_url", () => {
    renderTab({ url: "http://localhost:23333", serviceState: "running" });
    const frame = screen.getByTitle(en["tab.panel"]);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "http://localhost:23333");
  });

  it("browser_tab_shows_overlay_when_down", () => {
    renderTab({ serviceState: "stopped" });
    expect(screen.getByText(en["browser.notRunning.title"])).toBeInTheDocument();
    expect(screen.getByText(en["browser.notRunning.hint"])).toBeInTheDocument();
    expect(screen.queryByTitle(en["tab.panel"])).not.toBeInTheDocument();
  });

  it("refresh reloads frame key", async () => {
    const user = userEvent.setup();
    renderTab({ serviceState: "running" });
    const before = screen.getByTitle(en["tab.panel"]).getAttribute("data-refresh");
    await user.click(screen.getByRole("button", { name: en["browser.refresh"] }));
    const after = screen.getByTitle(en["tab.panel"]).getAttribute("data-refresh");
    expect(after).not.toBe(before);
  });

  it("external button delegates to onOpenExternal", async () => {
    const user = userEvent.setup();
    const view = renderTab({ serviceState: "running" });
    await user.click(screen.getByRole("button", { name: en["browser.openExternal"] }));
    expect(view.onOpenExternal).toHaveBeenCalledTimes(1);
  });

  it("start button calls onStartPanel", async () => {
    const user = userEvent.setup();
    const view = renderTab({ serviceState: "stopped" });
    await user.click(screen.getByRole("button", { name: en["action.start"] }));
    expect(view.onStartPanel).toHaveBeenCalledTimes(1);
  });

  it("readiness badge shows when ready provided", () => {
    renderTab({ serviceState: "running", ready: true });
    expect(screen.getByText(en["status.ready"])).toBeInTheDocument();
  });
});
