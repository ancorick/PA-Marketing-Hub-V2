import { Tray } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Says what is empty and what to do next, with at most one action (PRD 13.7). */
export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon">{icon ?? <Tray size={28} weight="bold" aria-hidden />}</span>
      <span className="empty__title">{title}</span>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
