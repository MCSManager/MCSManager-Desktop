import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge } from "../../test/mockBridge";
import { TabBar, type TabId } from "./TabBar";
import { TopBar } from "./TopBar";

describe("layout", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServicesStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders app title from i18n", () => {
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByText(en["app.title"])).toBeInTheDocument();
  });

  it("tab switching calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(id: TabId) => void>();
    const tabs: { id: TabId; label: string }[] = [
      { id: "dashboard", label: en["tab.dashboard"] },
      { id: "panel", label: en["tab.panel"] },
    ];
    render(<TabBar tabs={tabs} active="dashboard" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("panel");
  });

  it("open_external_button_sits_beside_tab_bar_on_panel_tab", async () => {
    const user = userEvent.setup();
    const onOpenExternal = vi.fn();
    render(
      <I18nProvider initialLanguage="en">
        <TopBar
          activeTab="panel"
          onTabChange={() => {}}
          onStartAll={() => {}}
          onStopAll={() => {}}
          onOpenSettings={() => {}}
          onOpenExternal={onOpenExternal}
          busy={false}
        />
      </I18nProvider>,
    );
    const button = within(screen.getByRole("banner")).getByRole("button", {
      name: en["browser.openExternal"],
    });
    await user.click(button);
    expect(onOpenExternal).toHaveBeenCalledTimes(1);
  });

  it("open_external_button_hidden_on_dashboard_tab", () => {
    render(
      <I18nProvider initialLanguage="en">
        <TopBar
          activeTab="dashboard"
          onTabChange={() => {}}
          onStartAll={() => {}}
          onStopAll={() => {}}
          onOpenSettings={() => {}}
          onOpenExternal={() => {}}
          busy={false}
        />
      </I18nProvider>,
    );
    expect(
      screen.queryByRole("button", { name: en["browser.openExternal"] }),
    ).not.toBeInTheDocument();
  });

  it("language switcher flips visible copy", async () => {
    const user = userEvent.setup();
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByText(en["app.title"])).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: zh["language.zh"] }));
    expect(screen.getByText(zh["app.title"])).toBeInTheDocument();
  });

  it("start all button is wired", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    render(<App bridge={mock} />);
    await user.click(screen.getByRole("button", { name: en["action.startAll"] }));
    expect(mock.calls.filter((call) => call.name === "startAll")).toHaveLength(1);
  });

  it("settings button opens settings", async () => {
    const user = userEvent.setup();
    render(<App bridge={createMockBridge()} />);
    await user.click(screen.getByRole("button", { name: en["settings.title"] }));
    expect(screen.getByRole("heading", { name: en["settings.title"] })).toBeInTheDocument();
  });

  it("switches tab content between dashboard and browser", async () => {
    const user = userEvent.setup();
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByTestId("service-card-daemon")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    expect(screen.getByText(en["browser.notRunning.title"])).toBeInTheDocument();
  });
});
