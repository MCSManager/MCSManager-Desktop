import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import en from "../../i18n/locales/en.json";
import { ContextMenu } from "./ContextMenu";

const writeText = vi.fn<() => Promise<void>>();
const readText = vi.fn<() => Promise<string>>();

function renderMenu() {
  return render(
    <I18nProvider initialLanguage="en">
      <input aria-label="probe" />
      <ContextMenu />
    </I18nProvider>,
  );
}

function rightClick(target: Element, x = 12, y = 34) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("context menu", () => {
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    readText.mockReset().mockResolvedValue("");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("right_click_shows_custom_menu_and_suppresses_native", () => {
    renderMenu();
    const event = rightClick(document.body);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: en["contextMenu.copy"] })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: en["contextMenu.paste"] })).toBeInTheDocument();
  });

  it("iframe_targets_keep_the_native_menu", () => {
    renderMenu();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const event = rightClick(frame);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    frame.remove();
  });

  it("copy_writes_the_current_selection_to_the_clipboard", async () => {
    renderMenu();
    const input = screen.getByLabelText("probe") as HTMLInputElement;
    input.focus();
    input.value = "hello world";
    input.setSelectionRange(0, 5);
    rightClick(input);
    fireEvent.click(screen.getByRole("menuitem", { name: en["contextMenu.copy"] }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello");
    });
  });

  it("paste_inserts_clipboard_text_into_the_focused_input", async () => {
    renderMenu();
    const input = screen.getByLabelText("probe") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 0);
    readText.mockResolvedValue("pasted");
    rightClick(input);
    fireEvent.click(screen.getByRole("menuitem", { name: en["contextMenu.paste"] }));
    await waitFor(() => {
      expect(input.value).toBe("pasted");
    });
  });

  it("menu_closes_on_escape_and_on_outside_click", async () => {
    renderMenu();
    rightClick(document.body);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rightClick(document.body);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
