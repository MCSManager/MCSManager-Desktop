import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { ConsoleLine } from "../../state/consoleBuffer";
import { Icon } from "../layout/Icon";

export function ConsolePanel({
  lines,
  onClear,
  onCopy,
}: {
  lines: ConsoleLine[];
  onClear: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <section className="console" aria-label={t("console.title")}>
      <header className="console-head">
        <h3 className="console-title">{t("console.title")}</h3>
        <label className="console-autoscroll">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          <span>{t("console.autoScroll")}</span>
        </label>
        <button
          type="button"
          className="console-btn"
          onClick={onCopy}
          aria-label={t("console.copy")}
          title={t("console.copy")}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          className="console-btn"
          onClick={onClear}
          aria-label={t("console.clear")}
          title={t("console.clear")}
        >
          <Icon name="trash" />
        </button>
      </header>
      <div className="console-body" ref={bodyRef}>
        {lines.map((line) => (
          <div
            key={line.id}
            className={`console-line console-line--${line.stream}`}
            data-stream={line.stream}
          >
            {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}
