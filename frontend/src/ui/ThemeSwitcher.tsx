import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';

export type ThemeChoice = 'dark' | 'light' | 'system';
export const THEME_STORAGE_KEY = 'mh-theme';

const OPTIONS = [
  { value: 'dark', label: 'theme.dark', icon: Moon },
  { value: 'light', label: 'theme.light', icon: Sun },
  { value: 'system', label: 'theme.system', icon: Desktop },
] as const;

function readChoice(): ThemeChoice {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === 'light' || saved === 'system' ? saved : 'dark';
}

/** Dark is the brand default; light is opt-in. "system" follows prefers-color-scheme live. */
function apply(choice: ThemeChoice) {
  const light = choice === 'light' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
}

export function ThemeSwitcher() {
  const t = useT();
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  useEffect(() => {
    apply(choice);
    if (choice === 'dark') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
    if (choice !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  return (
    <div className="segmented" role="group" aria-label={t('theme.group')}>
      {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
        <button
          key={value}
          type="button"
          className="segmented__btn"
          aria-pressed={choice === value}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => setChoice(value)}
        >
          <ItemIcon size={16} weight="bold" aria-hidden />
        </button>
      ))}
    </div>
  );
}
