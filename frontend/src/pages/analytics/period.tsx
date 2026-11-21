import { useSyncExternalStore } from 'react';
import type { Period } from '../../lib/api';
import { TextField } from '../../ui';

/** Yerevan date (UTC+4, no daylight saving) as YYYY-MM-DD. */
export const yerevanToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

/** Presets for the date range of analytics views (ANL-08: any date range, up to 24 months). */
export function presets(today = yerevanToday()): { id: string; label: string; period: Period }[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const month = m - 1;
  const quarter = Math.floor(month / 3) * 3;
  return [
    { id: 'this_month', label: 'This month', period: { from: iso(y, month, 1), to: today } },
    { id: 'last_month', label: 'Last month', period: { from: iso(y, month - 1, 1), to: iso(y, month, 0) } },
    { id: 'last_quarter', label: 'Last quarter', period: { from: iso(y, quarter - 3, 1), to: iso(y, quarter, 0) } },
    { id: 'last_12_months', label: 'Last 12 months', period: { from: iso(y, month - 11, 1), to: today } },
  ];
}

const KEY = 'mh-analytics-period';
const listeners = new Set<() => void>();
let cached: string | null = null;

function read(): string {
  try {
    cached = sessionStorage.getItem(KEY) ?? cached;
  } catch {
    // storage blocked: keep the in-memory value
  }
  return cached ?? JSON.stringify(presets().find((preset) => preset.id === 'last_quarter')!.period);
}

function write(period: Period) {
  cached = JSON.stringify(period);
  try {
    sessionStorage.setItem(KEY, cached);
  } catch {
    // storage blocked
  }
  listeners.forEach((listener) => listener());
}

/** The period shared by all analytics views in this tab, so switching views keeps the range. */
export function usePeriod(): [Period, (period: Period) => void] {
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    read,
  );
  return [JSON.parse(raw) as Period, write];
}

/** Preset pills plus custom from/to dates. */
export function PeriodPicker({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  const options = presets();
  return (
    <div className="period-picker">
      <div className="segmented" role="group" aria-label="Date range">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="segmented__btn"
            aria-pressed={option.period.from === period.from && option.period.to === period.to}
            onClick={() => onChange(option.period)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <TextField label="From" type="date" value={period.from} max={period.to} onChange={(event) => event.target.value && onChange({ ...period, from: event.target.value })} />
      <TextField label="To" type="date" value={period.to} min={period.from} onChange={(event) => event.target.value && onChange({ ...period, to: event.target.value })} />
    </div>
  );
}
