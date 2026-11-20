import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Filter chip: a toggle button (aria-pressed). Selected chips are aqua, like the concept's "Բոլորը". */
export function Chip({
  selected,
  icon,
  count,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & { selected: boolean; icon?: ReactNode; count?: number }) {
  return (
    <button type="button" className="chip" aria-pressed={selected} {...rest}>
      {icon}
      {children}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  );
}

/** Hashtag-like label: non-interactive. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}
