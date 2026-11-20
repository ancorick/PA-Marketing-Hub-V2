import { Info } from '@phosphor-icons/react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * Definition tooltip: opens on hover and on keyboard focus, closes on Escape (WCAG 1.4.13).
 * Used for metric definitions and attribution model on every number (PRD 13.7).
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="tooltip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="tooltip__trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={16} aria-hidden />
      </button>
      {open && (
        <span role="tooltip" id={id} className="tooltip__content">
          {children}
        </span>
      )}
    </span>
  );
}
