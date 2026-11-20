import { AnimatePresence, m } from 'motion/react';
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { popoverTransition } from '../lib/motion';

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; separatorBefore?: boolean };

/**
 * Dropdown menu (WAI-ARIA menu button): Enter/Space/ArrowDown opens and focuses the first item,
 * arrows move, Home/End jump, Escape closes and returns focus, Tab or a click outside closes.
 * Grows from the trigger (scale + fade), exit faster than enter.
 */
export function Menu({ label, trigger, items }: { label: string; trigger: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const focusItem = (index: number) => {
    const count = items.length;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => focusItem(0));
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <m.ul id={menuId} role="menu" aria-label={label} className="menu__list" onKeyDown={onMenuKeyDown} {...popoverTransition}>
            {items.map((item, index) => (
              <Fragment key={item.label}>
                {item.separatorBefore && <li role="separator" className="menu__sep" />}
                <li role="none">
                  <button
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </li>
              </Fragment>
            ))}
          </m.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
