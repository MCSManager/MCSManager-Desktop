import { createContext, useContext, useState, type ReactNode } from "react";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type Language = "en" | "zh";

const STORAGE_KEY = "mcsm-desktop.lang";

type Dictionary = Record<string, string>;

const dictionaries: Record<Language, Dictionary> = { en, zh };

function isLanguage(value: string | null): value is Language {
  return value === "en" || value === "zh";
}

function readStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore storage failures; in-memory state is the source of truth.
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
  return interpolate(template, vars);
}

export interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(
    () => initialLanguage ?? readStoredLanguage() ?? "en",
  );

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    writeStoredLanguage(next);
  };

  const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
