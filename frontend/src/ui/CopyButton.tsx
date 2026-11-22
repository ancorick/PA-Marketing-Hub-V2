import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { Button } from './Button';

/**
 * Icon button that copies a value (DNS hosts and records). The result is announced politely and
 * shown as a check mark for 2 s; if the clipboard is blocked, it says to select the text instead.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <span className="copy">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={label}
        title={label}
        icon={
          state === 'copied' ? <Check size={16} weight="bold" aria-hidden /> : <Copy size={16} weight="bold" aria-hidden />
        }
        onClick={() => void copy()}
      />
      <span className="visually-hidden" role="status">
        {state === 'copied' ? t('copy.copied') : state === 'failed' ? t('copy.failed') : ''}
      </span>
    </span>
  );
}
