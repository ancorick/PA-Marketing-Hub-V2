import { formatPercent } from '../../lib/format';
import type { IssueStatus, SendStatus } from '../../lib/api';
import type { Tone } from '../../ui';

/*
 * Pieces shared by the SEND and SETTINGS pages (RESTRUCTURE R5). Labels come from the string tables
 * (`s.issue.<status>`, `s.send.<status>`); only the badge tone lives here.
 */

export const ISSUE_TONE: Record<IssueStatus, Tone> = {
  collecting: 'neutral',
  draft: 'info',
  in_review: 'warning',
  approved: 'success',
  scheduled: 'success',
  sent: 'success',
};

export const SEND_TONE: Record<SendStatus, Tone> = {
  draft: 'neutral',
  approved: 'info',
  scheduled: 'info',
  sending: 'warning',
  paused: 'warning',
  sent: 'success',
  cancelled: 'neutral',
};

/** Share as a fraction, or null when there is nothing to divide by. */
export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/** "7.2%", or "—" when the rate is unknown. */
export const percentText = (value: number | null): string => (value === null ? '—' : formatPercent(value));

/** A rate as a chart value in percent points, rounded to one decimal. */
export const percentPoints = (value: number | null): number => (value === null ? 0 : Math.round(value * 1000) / 10);
