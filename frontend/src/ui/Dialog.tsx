import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../lib/i18n';

/**
 * Modal dialog and side drawer on the native <dialog> (RESTRUCTURE §4): focus moves in and returns to the
 * trigger, Escape and the close button dismiss it, the page behind is inert. The drawer slides in from the right
 * for details and forms that keep the page in view (contact card, manual event).
 */
function DialogBase({
  open,
  onClose,
  title,
  description,
  footer,
  variant,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  variant: 'modal' | 'drawer';
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={variant === 'drawer' ? 'drawer-panel' : 'modal'}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__inner">
        <header className="dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={t('dialog.close')} onClick={onClose}>
            <X size={20} weight="bold" aria-hidden />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function Modal(props: Omit<Parameters<typeof DialogBase>[0], 'variant'>) {
  return <DialogBase {...props} variant="modal" />;
}

export function Drawer(props: Omit<Parameters<typeof DialogBase>[0], 'variant'>) {
  return <DialogBase {...props} variant="drawer" />;
}
