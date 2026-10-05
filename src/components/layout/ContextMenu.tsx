import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

interface MenuPosition {
  x: number;
  y: number;
}

const MENU_MARGIN = 4;
const MENU_WIDTH = 148;
const MENU_HEIGHT = 84;

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "password", "email", "number"]);

function isEditableField(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

function readFieldSelection(field: HTMLInputElement | HTMLTextAreaElement): {
  start: number;
  end: number;
} {
  try {
    return { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 };
  } catch {
    return { start: 0, end: field.value.length };
  }
}

function getSelectionText(): string {
  const active = document.activeElement;
  if (isEditableField(active)) {
    const { start, end } = readFieldSelection(active);
    return active.value.slice(start, end);
  }
  return window.getSelection()?.toString() ?? "";
}

function insertText(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const { start, end } = readFieldSelection(field);
  const next = field.value.slice(0, start) + text + field.value.slice(end);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    const caret = start + text.length;
    field.setSelectionRange(caret, caret);
  } catch {
    // Selection APIs are unsupported on some input types (e.g. number).
  }
}

export function ContextMenu() {
  const { t } = useI18n();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      // Embedded web content keeps its own context menu.
      if (target instanceof Element && target.tagName === "IFRAME") {
        return;
      }
      event.preventDefault();
      setPosition({
        x: Math.max(
          MENU_MARGIN,
          Math.min(event.clientX, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
        ),
        y: Math.max(
          MENU_MARGIN,
          Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - MENU_MARGIN),
        ),
      });
    };
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setPosition(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosition(null);
      }
    };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (position == null) {
    return null;
  }

  const handleCopy = () => {
    const text = getSelectionText();
    setPosition(null);
    if (!text) {
      return;
    }
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const handlePaste = () => {
    const field = document.activeElement;
    setPosition(null);
    if (!isEditableField(field)) {
      return;
    }
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) {
          insertText(field, text);
        }
      })
      .catch(() => {});
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        role="menuitem"
        className="context-menu-item"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleCopy}
      >
        {t("contextMenu.copy")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu-item"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handlePaste}
      >
        {t("contextMenu.paste")}
      </button>
    </div>
  );
}
