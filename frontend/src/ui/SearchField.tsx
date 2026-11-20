import { MagnifyingGlass } from '@phosphor-icons/react';
import type { InputHTMLAttributes } from 'react';

/**
 * The main search field: animated rainbow border with a soft halo (CSS, one element per page).
 * The rainbow is decoration; focus is shown by the standard ring. Reduced motion: static rainbow.
 */
export function SearchField({
  label,
  shortcut,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; shortcut?: string }) {
  return (
    <div className="search-shell">
      <div className="search" role="search">
        <span className="search__icon" aria-hidden>
          <MagnifyingGlass size={20} weight="bold" />
        </span>
        <input type="search" className="search__input" aria-label={label} {...input} />
        {shortcut && <kbd aria-hidden>{shortcut}</kbd>}
      </div>
    </div>
  );
}
