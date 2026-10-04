import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { resetServicesStore } from "../../state/serviceStore";
import { createMockBridge } from "../../test/mockBridge";
import { TabBar, type TabId } from "./TabBar";

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
