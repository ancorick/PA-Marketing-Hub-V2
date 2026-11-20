import { SpinnerGap } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Disables the button and shows a spinner while an async action runs. */
  loading?: boolean;
  /** Decorative icon shown before the label. */
  icon?: ReactNode;
  /** Icon-only button: children are ignored visually, aria-label is required. */
  iconOnly?: boolean;
};

/** One primary button per view; destructive actions use variant="danger" behind a ConfirmDialog. */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconOnly = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', iconOnly && 'btn--icon', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <SpinnerGap size={16} className="spinner" aria-hidden /> : icon}
      {iconOnly ? null : children}
    </button>
  );
}
