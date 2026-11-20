import type { ChannelId } from './fields.js';

/**
 * utm_source / utm_medium → channel of the 9.3 taxonomy (AUD-20, Flow A). The same table seeds the
 * Channel settings in phase 3 (ANL-03), where unmatched values are queued for review.
 */
const BY_MEDIUM: Record<string, ChannelId> = {
  paid_social: 'paid_social',
  paidsocial: 'paid_social',
  social: 'organic_social',
  organic_social: 'organic_social',
  organic: 'search_website',
  cpc: 'paid_search',
  ppc: 'paid_search',
  email: 'email',
  offline: 'events',
  event: 'events',
  referral: 'referrals',
  chat: 'chatbot',
  partner: 'partners_press',
  press: 'partners_press',
};

/** Unknown or missing parameters count as the website itself (direct visit or organic search). */
export function channelFromUtm(source: string | null | undefined, medium: string | null | undefined): ChannelId {
  const key = medium?.trim().toLowerCase() ?? '';
  if (BY_MEDIUM[key]) return BY_MEDIUM[key];
  if (source?.trim().toLowerCase() === 'chatbot') return 'chatbot';
  return 'search_website';
}
