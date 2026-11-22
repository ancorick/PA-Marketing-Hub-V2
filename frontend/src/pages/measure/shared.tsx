import { DownloadSimple, Printer } from '@phosphor-icons/react';
import { lazy } from 'react';
import type { Channel, Count } from '../../lib/api';
import { formatAmd, formatNumber, SMALL_NUMBER_TEXT } from '../../lib/format';
import { useStaffLang, useT, type StaffLang, type StringKey } from '../../lib/i18n';
import { Button } from '../../ui';
import { countText } from '../analytics/numbers';

/*
 * Shared pieces of the MEASURE pages (RESTRUCTURE R3): Overview, Cohorts, Costs, Campaigns & links and Data
 * health. The chart kit is loaded lazily, so Recharts stays out of the main bundle.
 */

const Charts = () => import('../../charts');
export const BarChart = lazy(() => Charts().then((mod) => ({ default: mod.BarChart })));
export const LineChart = lazy(() => Charts().then((mod) => ({ default: mod.LineChart })));
export const FunnelChart = lazy(() => Charts().then((mod) => ({ default: mod.FunnelChart })));
export const DonutChart = lazy(() => Charts().then((mod) => ({ default: mod.DonutChart })));

/** The API names attribution models in English; the interface shows the filter's name in the reader's language. */
const MODEL_KEY: Record<string, StringKey> = {
  'First touch': 'filter.firstTouch',
  'Last touch (before application)': 'filter.lastTouch',
  'Position-based (40/20/40)': 'filter.positionBased',
};

export function modelName(t: ReturnType<typeof useT>, label: string): string {
  const key = MODEL_KEY[label];
  return key ? t(key) : label;
}

const LOCALE: Record<StaffLang, string> = { en: 'en-GB', hy: 'hy-AM', ru: 'ru-RU' };

/** Month of a cohort or bucket ("2026-10" or "2026-10-01") as "Oct 26" in the interface language. */
export function useMonthLabel() {
  const lang = useStaffLang();
  return (month: string) =>
    new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(LOCALE[lang], { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** A day as "5 Oct" (week buckets) or "5 Oct 2026" (tables) in the interface language. */
export function useDayLabel() {
  const lang = useStaffLang();
  return (day: string, withYear = false) =>
    new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** A moment as "28 Nov 2026, 18:30" in Yerevan time and the interface language. */
export function useDateTimeLabel() {
  const lang = useStaffLang();
  return (iso: string) =>
    new Date(iso).toLocaleString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yerevan' });
}

/** Bucket label of a trend point: weeks by their Monday, months by name. */
export function useBucketLabel() {
  const month = useMonthLabel();
  const day = useDayLabel();
  return (start: string, granularity: 'week' | 'month') => (granularity === 'week' ? day(start) : month(start));
}

/** Money cell: AMD with thousand separators, or "—" when there is no value. */
export const amd = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatAmd(value));

/** A count for a chart: suppressed counts ("fewer than 3") are drawn at 1.5 and labelled with words. */
export const chartCount = (value: Count) => (value === 'fewer_than_3' ? 1.5 : value);
export const chartCountFormat = (shared: boolean) => (value: number) =>
  shared && value === 1.5 ? SMALL_NUMBER_TEXT : formatNumber(value, undefined, { maximumFractionDigits: 1 });
export const numberOf = (value: Count) => (value === 'fewer_than_3' ? null : value);
export const countOrWords = (value: Count) => countText(value);

export const channelName = (id: string | null, channels: Channel[] | undefined) =>
  id === null ? '—' : id === 'unmapped' ? 'Unmapped' : id === 'unattributed' ? 'No recorded touch' : (channels?.find((channel) => channel.id === id)?.name ?? id);

/** Page-level Export CSV (RESTRUCTURE §4: header actions). */
export function ExportCsvButton({ onExport, disabled }: { onExport: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Button className="no-print" variant="secondary" icon={<DownloadSimple size={18} aria-hidden />} disabled={disabled} onClick={onExport}>
      {t('m.exportCsv')}
    </Button>
  );
}

/** Print / PDF: the print stylesheet switches to the light theme and hides controls. */
export function PrintButton({ disabled }: { disabled?: boolean }) {
  const t = useT();
  return (
    <Button className="no-print" variant="secondary" icon={<Printer size={18} aria-hidden />} disabled={disabled} onClick={() => window.print()}>
      {t('m.print')}
    </Button>
  );
}

/** Channel select inside the filter bar. */
export function ChannelFilter({ value, onChange, channels }: { value: string; onChange: (channel: string) => void; channels: Channel[] }) {
  const t = useT();
  return (
    <label className="filter">
      <span className="filter__label">{t('m.channel')}</span>
      <select className="select select--sm" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('m.allChannels')}</option>
        {channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.name}
          </option>
        ))}
      </select>
    </label>
  );
}
