import { CaretDown } from '@phosphor-icons/react';
import { AnimatePresence, m } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import { duration, ease, exitOf } from '../lib/motion';

/**
 * Expandable section (lists, "show table" under a chart, advanced filters).
 * Button with aria-expanded/aria-controls; the panel animates height and opacity.
 * Height animation is acceptable here: panels are short and the effect is user-initiated.
 */
export function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="disclosure">
      <button type="button" className="disclosure__trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {title}
        <CaretDown size={18} weight="bold" className="disclosure__chevron" aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={id}
            className="disclosure__panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { duration: duration.moderate, ease: ease.enter } }}
            exit={{ height: 0, opacity: 0, transition: { duration: exitOf(duration.moderate), ease: ease.exit } }}
          >
            <div className="disclosure__inner">{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
