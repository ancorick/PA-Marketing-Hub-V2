import type { StringKey } from './i18n';

/** A date range as Yerevan calendar dates (YYYY-MM-DD). */
export type DateRange = { from: string; to: string };

export type PresetId = '30d' | '90d' | 'last_quarter' | 'this_year' | '12m' | 'custom';

/** Period presets of every analytics page (RESTRUCTURE §4). */
export const PERIOD_PRESETS: { id: Exclude<PresetId, 'custom'>; label: StringKey }[] = [
  { id: '30d', label: 'filter.30d' },
  { id: '90d', label: 'filter.90d' },
  { id: 'last_quarter', label: 'filter.lastQuarter' },
  { id: 'this_year', label: 'filter.thisYear' },
  { id: '12m', label: 'filter.12m' },
];

const DAY = 86_400_000;
/** Today in Yerevan (UTC+4, no daylight saving). */
export const yerevanToday = (now = Date.now()) => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

export function presetRange(id: Exclude<PresetId, 'custom'>, today = yerevanToday()): DateRange {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (id) {
    case '30d':
      return { from: shift(today, -29), to: today };
    case '90d':
      return { from: shift(today, -89), to: today };
    case 'last_quarter': {
      const quarterStart = Math.floor((m - 1) / 3) * 3;
      return { from: iso(y, quarterStart - 3, 1), to: iso(y, quarterStart, 0) };
    }
    case 'this_year':
      return { from: iso(y, 0, 1), to: today };
    case '12m':
      return { from: shift(today, -364), to: today };
  }
}

/** Which preset a range matches, or "custom". */
export function presetOf(range: DateRange, today = yerevanToday()): PresetId {
  return PERIOD_PRESETS.find((preset) => {
    const candidate = presetRange(preset.id, today);
    return candidate.from === range.from && candidate.to === range.to;
  })?.id ?? 'custom';
}
