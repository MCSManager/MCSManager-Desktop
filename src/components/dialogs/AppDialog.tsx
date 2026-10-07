export interface AppDialogProps {
  title: string;
  message: string;
  hint?: string;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  testId?: string;
}

/// Centered modal dialog used for startup errors and destructive confirmations.
export function AppDialog({
  title,
  message,
  hint,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  testId,
}: AppDialogProps) {
  return (
    <div className="dialog-overlay" data-testid={testId}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog-title">{title}</h2>
        <p className="dialog-message">{message}</p>
        {hint ? <p className="dialog-hint">{hint}</p> : null}
        <div className="dialog-actions">
          {onCancel && cancelLabel ? (
            <button type="button" className="dialog-btn" onClick={onCancel}>
              {cancelLabel}
            </button>
          ) : null}
          <button type="button" className="dialog-btn dialog-btn--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
