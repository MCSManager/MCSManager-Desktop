import { useI18n, type Language } from "../../i18n";

export function LanguageSwitcher({
  language,
  onChange,
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="lang-switch">
      <button
        type="button"
        className={language === "en" ? "lang-pill lang-pill--active" : "lang-pill"}
        aria-pressed={language === "en"}
        onClick={() => onChange("en")}
      >
        {t("language.en")}
      </button>
      <button
        type="button"
        className={language === "zh" ? "lang-pill lang-pill--active" : "lang-pill"}
        aria-pressed={language === "zh"}
        onClick={() => onChange("zh")}
      >
        {t("language.zh")}
      </button>
    </div>
  );
}
