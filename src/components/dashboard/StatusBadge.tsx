import { useI18n } from "../../i18n";
import type { ServiceState } from "../../types";

export function StatusBadge({ state }: { state: ServiceState }) {
  const { t } = useI18n();
  return (
    <span className={`badge badge--${state}`} data-state={state}>
      <span className="badge-dot" aria-hidden="true" />
      {t("state." + state)}
    </span>
  );
}
