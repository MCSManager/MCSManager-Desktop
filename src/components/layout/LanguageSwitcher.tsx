import { useEffect, useRef, useState } from "react";
import { useI18n, type Language } from "../../i18n";
import { Icon } from "./Icon";

const OPTIONS: { id: Language; labelKey: string }[] = [
  { id: "en", labelKey: "language.en" },
  { id: "zh", labelKey: "language.zh" },
];

export function LanguageSwitcher({
  language,
  onChange,
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lang-switch" ref={rootRef}>
      <button
        type="button"
        className="topbar-btn topbar-btn--icon"
        aria-label={t("language.switcher")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="globe" />
      </button>
      {open ? (
        <div className="lang-menu" role="menu">
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={language === option.id}
              className={
                language === option.id ? "lang-menu-item lang-menu-item--active" : "lang-menu-item"
              }
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
