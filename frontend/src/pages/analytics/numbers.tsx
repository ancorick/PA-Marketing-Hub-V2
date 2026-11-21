import type { Channel, Count, Stage } from '../../lib/api';
import { formatNumber, SMALL_NUMBER_TEXT } from '../../lib/format';

/** Rows that are not taxonomy channels but must stay visible (ANL-03, R6). */
export const SPECIAL_CHANNELS: Record<string, string> = { unmapped: 'Unmapped', unattributed: 'No recorded touch' };

export const channelLabel = (id: string, channels: Channel[] | undefined) => SPECIAL_CHANNELS[id] ?? channels?.find((channel) => channel.id === id)?.name ?? id;

export const STAGE_LABEL: Record<Stage, string> = { lead: 'Leads', applied: 'Applicants', enrolled: 'Enrolled', completed: 'Completed', hired: 'Hired' };

/** Position-based credit can be fractional; show up to one decimal. */
export const countText = (value: Count) => (value === 'fewer_than_3' ? SMALL_NUMBER_TEXT : formatNumber(value, undefined, { maximumFractionDigits: 1 }));

export const countValue = (value: Count) => (value === 'fewer_than_3' ? 1.5 : value);

/** Hash link to the people behind a count (ANL-15). */
export const peoplePath = (stage: Stage, channel: string, campaign?: string) =>
  `#/analytics/people/${stage}/${encodeURIComponent(channel)}${campaign ? `/${encodeURIComponent(campaign)}` : ''}`;

/** A count cell: "fewer than 3" when suppressed; a link to the people behind it for marketing roles. */
export function CountCell({ value, href, label }: { value: Count; href?: string | null; label: string }) {
  if (value === 'fewer_than_3') return <span className="muted">{SMALL_NUMBER_TEXT}</span>;
  if (!href || value === 0) return <>{countText(value)}</>;
  return (
    <a href={href} aria-label={`${countText(value)} ${label}: see the people`}>
      {countText(value)}
    </a>
  );
}
