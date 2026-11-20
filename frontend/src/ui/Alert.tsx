import { CheckCircle, Info, Warning, WarningCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ICONS = { info: Info, success: CheckCircle, warning: Warning, danger: WarningCircle } as const;

/** Inline message with a recovery action. Only errors interrupt screen readers (role="alert"). */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={20} weight="bold" aria-hidden />
      <div className="alert__body">
        <span className="alert__title">{title}</span>
        {children && <span>{children}</span>}
        {action && <span>{action}</span>}
      </div>
    </div>
  );
}
