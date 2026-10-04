import { useI18n } from "../../i18n";
import { Icon, type IconName } from "../layout/Icon";

export type ActionKind = "start" | "stop" | "restart";

const ICONS: Record<ActionKind, IconName> = {
  start: "play",
  stop: "stop",
  restart: "restart",
};

export function ActionButton({
  kind,
  busy = false,
  disabled = false,
  onClick,
}: {
  kind: ActionKind;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`card-action card-action--${kind}`}
      onClick={onClick}
      disabled={disabled || busy}
      data-busy={busy ? "true" : undefined}
    >
      <Icon name={ICONS[kind]} />
      <span>{t("action." + kind)}</span>
    </button>
  );
}
