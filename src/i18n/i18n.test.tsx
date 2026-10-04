import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import { I18nProvider, useI18n } from "./index";

interface ProbeProps {
  messageKey: string;
  vars?: Record<string, string | number>;
}

function Probe({ messageKey, vars }: ProbeProps) {
  const { language, setLanguage, t } = useI18n();
  return (
    <div>
      <span data-testid="output">{t(messageKey, vars)}</span>
      <span data-testid="language">{language}</span>
      <button type="button" onClick={() => setLanguage("en")}>
        to-en
      </button>
      <button type="button" onClick={() => setLanguage("zh")}>
        to-zh
      </button>
    </div>
  );
}

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to English", () => {
    render(
      <I18nProvider>
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe("Start");
    expect(screen.getByTestId("language").textContent).toBe("en");
  });

  it("switches to Chinese", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "to-zh" }));
    expect(screen.getByTestId("output").textContent).toBe(zh["action.start"]);
    expect(screen.getByTestId("language").textContent).toBe("zh");
  });

  it("falls back to English for missing keys", async () => {
    vi.resetModules();
    const subset: Record<string, string> = { ...zh };
    delete subset["settings.about"];
    vi.doMock("./locales/zh.json", () => ({ default: subset }));
    const { I18nProvider: DynamicProvider, useI18n: useDynamicI18n } = await import("./index");

    function FallbackProbe() {
      const { t } = useDynamicI18n();
      return <span data-testid="output">{t("settings.about")}</span>;
    }

    render(
      <DynamicProvider initialLanguage="zh">
        <FallbackProbe />
      </DynamicProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe(en["settings.about"]);

    vi.doUnmock("./locales/zh.json");
    vi.resetModules();
  });

  it("returns key when missing everywhere", () => {
    render(
      <I18nProvider>
        <Probe messageKey="nope.key" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe("nope.key");
  });

  it("interpolates variables", () => {
    render(
      <I18nProvider>
        <Probe messageKey="status.pid" vars={{ pid: 42 }} />
      </I18nProvider>,
    );
    const output = screen.getByTestId("output").textContent ?? "";
    expect(output).toContain("42");
    expect(output).not.toContain("{pid}");
  });

  it("persists language choice", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "to-zh" }));
    expect(localStorage.getItem("mcsm-desktop.lang")).toBe("zh");
    await user.click(screen.getByRole("button", { name: "to-en" }));
    expect(localStorage.getItem("mcsm-desktop.lang")).toBe("en");
  });

  it("uses initialLanguage when provided", () => {
    render(
      <I18nProvider initialLanguage="zh">
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe(zh["action.start"]);
  });

  it("reads persisted language on mount", () => {
    localStorage.setItem("mcsm-desktop.lang", "zh");
    render(
      <I18nProvider>
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe(zh["action.start"]);
  });

  it("ignores invalid persisted language", () => {
    localStorage.setItem("mcsm-desktop.lang", "fr");
    render(
      <I18nProvider>
        <Probe messageKey="action.start" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("output").textContent).toBe("Start");
  });

  it("locale files define identical key sets", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
