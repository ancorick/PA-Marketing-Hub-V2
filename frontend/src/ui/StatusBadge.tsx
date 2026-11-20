import { CheckCircle, Circle, Info, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const ICONS = { neutral: Circle, info: Info, success: CheckCircle, warning: WarningCircle, danger: XCircle } as const;

/** Status is always icon + text, never color alone (PRD 14.5). */
export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <span className={`badge badge--${tone}`}>
      <Icon size={14} weight="bold" aria-hidden />
      {children}
    </span>
  );
}

/** Solid brand label (concept "Ձեռնարկ", "Skill Map"): a category, not a status. */
export function BrandBadge({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="badge badge--brand">
      {icon}
      {children}
    </span>
  );
}
