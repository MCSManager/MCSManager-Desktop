import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AppDialog } from "../components/dialogs/AppDialog";
import { useI18n } from "../i18n";

export interface PortGuard {
  // Asks the user whether the program occupying `port` may be terminated.
  confirmPortKill(port: number): Promise<boolean>;
}

const PortGuardContext = createContext<PortGuard | null>(null);

interface PendingPort {
  port: number;
  resolve: (confirmed: boolean) => void;
}

// Renders the centered port-conflict confirmation dialog and exposes the
// promise-based `confirmPortKill` used by the guarded start actions.
export function PortGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingPort | null>(null);

  const confirmPortKill = useCallback(
    (port: number) => new Promise<boolean>((resolve) => setPending({ port, resolve })),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  return (
    <PortGuardContext.Provider value={{ confirmPortKill }}>
      {children}
      {pending ? (
        <AppDialog
          testId="port-conflict-dialog"
          title={t("portConflict.title")}
          message={t("portConflict.message", { port: pending.port })}
          hint={t("portConflict.hint")}
          confirmLabel={t("portConflict.confirm")}
          cancelLabel={t("portConflict.cancel")}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </PortGuardContext.Provider>
  );
}

export function usePortGuard(): PortGuard {
  const context = useContext(PortGuardContext);
  if (!context) {
    throw new Error("usePortGuard must be used within a PortGuardProvider");
  }
  return context;
}
