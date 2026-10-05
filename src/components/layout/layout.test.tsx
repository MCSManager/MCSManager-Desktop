import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge } from "../../test/mockBridge";
import { TabBar, type TabId } from "./TabBar";
import { TopBar } from "./TopBar";

function renderTopBar(
  overrides: Partial<ComponentProps<typeof TopBar>> = {},
  language: "en" | "zh" = "en",
) {
  const props: ComponentProps<typeof TopBar> = {
    activeTab: "panel",
    onTabChange: () => {},
    onStartAll: () => {},
    onStopAll: () => {},
    onOpenSettings: () => {},
    onOpenExternal: () => {},
    busy: false,
    hasActiveServices: false,
    ...overrides,
  };
  return render(
    <I18nProvider initialLanguage={language}>
      <TopBar {...props} />
    </I18nProvider>,
  );
}

describe("layout", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServicesStore();
  });

  afterEach(() => {
    cleanup();
    resetServicesStore();
  });

  it("renders tab labels from i18n", () => {
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByRole("tab", { name: en["tab.panel"] })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: en["tab.dashboard"] })).toBeInTheDocument();
  });

  it("panel tab is selected by default", () => {
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByRole("tab", { name: en["tab.panel"] })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: en["tab.dashboard"] })).toHaveAttribute(
      "aria-selected",
      "false",
    );
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
    renderTopBar({ activeTab: "panel", onOpenExternal });
    const button = within(screen.getByRole("contentinfo")).getByRole("button", {
      name: en["browser.openExternal"],
    });
    await user.click(button);
    expect(onOpenExternal).toHaveBeenCalledTimes(1);
  });

  it("open_external_button_hidden_on_dashboard_tab", () => {
    renderTopBar({ activeTab: "dashboard" });
    expect(
      screen.queryByRole("button", { name: en["browser.openExternal"] }),
    ).not.toBeInTheDocument();
  });

  it("start_all_button_shows_with_green_border_when_services_are_inactive", () => {
    renderTopBar({ hasActiveServices: false });
    const button = screen.getByRole("button", { name: en["action.startAll"] });
    expect(button).toHaveClass("topbar-btn--start");
    expect(screen.queryByRole("button", { name: en["action.stopAll"] })).not.toBeInTheDocument();
  });

  it("stop_all_button_shows_with_red_border_when_services_are_active", () => {
    renderTopBar({ hasActiveServices: true });
    const button = screen.getByRole("button", { name: en["action.stopAll"] });
    expect(button).toHaveClass("topbar-btn--stop");
    expect(screen.queryByRole("button", { name: en["action.startAll"] })).not.toBeInTheDocument();
  });

  it("language switcher flips visible copy", async () => {
    const user = userEvent.setup();
    render(<App bridge={createMockBridge()} />);
    expect(screen.getByRole("tab", { name: en["tab.dashboard"] })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en["language.switcher"] }));
    await user.click(screen.getByRole("menuitemradio", { name: zh["language.zh"] }));
    expect(screen.getByRole("tab", { name: zh["tab.dashboard"] })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: zh["tab.panel"] })).toBeInTheDocument();
  });

  it("start all button is wired", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    render(<App bridge={mock} />);
    await waitFor(() => {
      expect(mock.calls).toContainEqual({ name: "startAll", args: [] });
    });
    const before = mock.calls.filter((call) => call.name === "startAll").length;
    await user.click(screen.getByRole("button", { name: en["action.startAll"] }));
    expect(mock.calls.filter((call) => call.name === "startAll")).toHaveLength(before + 1);
  });

  it("settings button opens settings", async () => {
    const user = userEvent.setup();
    render(<App bridge={createMockBridge()} />);
    await user.click(screen.getByRole("button", { name: en["settings.title"] }));
    expect(screen.getByRole("heading", { name: en["settings.title"] })).toBeInTheDocument();
  });

  it("switches tab content between console and panel", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge();
    render(<App bridge={mock} settleDelayMs={0} />);

    expect(screen.getByText(en["browser.starting.title"])).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: en["tab.dashboard"] }));
    expect(screen.getByTestId("service-card-daemon")).toBeInTheDocument();
    expect(screen.getByTestId("service-card-panel")).toBeInTheDocument();

    await act(async () => {
      mock.emitStatus({ id: "daemon", state: "running", pid: 1001, startedAt: 1700000000000 });
      mock.emitStatus({ id: "panel", state: "running", pid: 1002, startedAt: 1700000000000 });
    });

    await user.click(screen.getByRole("tab", { name: en["tab.panel"] }));
    await waitFor(() => {
      expect(screen.getByTitle(en["tab.panel"])).toBeInTheDocument();
    });
    expect(screen.queryByTestId("service-card-daemon")).not.toBeInTheDocument();
  });
});
