import { useEffect, useId, useRef, type ReactNode } from 'react';
import { formatNumber } from '../lib/format';
import { Button } from './Button';

type ConfirmDialogProps = {
  open: boolean;
  /** The action as a question or verb phrase: "Send the March issue?" */
  title: string;
  /** Exactly what will happen (PRD 13.7). */
  children: ReactNode;
  /** How many people are affected; always shown. */
  affected: { count: number; noun: string };
  /** Repeats the verb: "Send to 1,240 contacts". */
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  locale?: string;
};

/**
 * Confirmation for send, merge, erase and the kill switch.
 * Native <dialog>: focus is trapped and returned by the browser, Escape cancels.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  affected,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  locale,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="dialog__body">
        <h2 id={titleId}>{title}</h2>
        <div id={descId} className="stack">
          <div>{children}</div>
          <p className="dialog__impact">
            Affects <strong className="num">{formatNumber(affected.count, locale)}</strong> {affected.noun}.
          </p>
        </div>
      </div>
      <div className="dialog__actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
