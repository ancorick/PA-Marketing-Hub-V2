import { WarningCircle } from '@phosphor-icons/react';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

type FieldFrameProps = {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
};

/** Visible label, hint and inline error linked with aria-describedby (WCAG 1.3.1, 3.3.1). */
function FieldFrame({ label, hint, error, required, children }: FieldFrameProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({ id, describedBy })}
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field__error">
          <WarningCircle size={16} weight="bold" aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
};

export function TextField({ label, hint, error, required, className, ...input }: TextFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className={['input', className].filter(Boolean).join(' ')}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
      )}
    </FieldFrame>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  options: { value: string; label: string }[];
};

export function SelectField({ label, hint, error, required, options, className, ...select }: SelectFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <select
          id={id}
          className={['select', className].filter(Boolean).join(' ')}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}
