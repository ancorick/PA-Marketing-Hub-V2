import { createHash } from 'node:crypto';
import type { Language, LifecycleStatus } from '../integrations/core-engine/contract.js';

/** Preferred language of a contact (AUD-02). */
export const LANGUAGES = ['hy', 'en', 'ru'] as const satisfies readonly Language[];

/** Subscriber is Marketing Hub's own type; the rest mirror the Core Engine and Navigator CRM (PRD 6.1). */
export const CONTACT_TYPES = ['subscriber', 'lead', 'applicant', 'student', 'alumnus'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

/** Marketing-only states (PRD 12.1). Only phase 1 suppression (AUD-09, AUD-12, EML-05/06) and erasure change them. */
export const CONTACT_STATUSES = ['active', 'unsubscribed', 'bounced', 'complained', 'erased'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/**
 * Channel taxonomy (PRD 9.3). It moves to settings with the Channel table in phase 3 (ANL-03);
 * the slugs stay the same so stored contacts keep their source.
 */
export const CHANNELS = [
  { id: 'paid_social', name: 'Paid social' },
  { id: 'organic_social', name: 'Organic social' },
  { id: 'search_website', name: 'Search and website' },
  { id: 'paid_search', name: 'Paid search' },
  { id: 'email', name: 'Email' },
  { id: 'events', name: 'Events and open days' },
  { id: 'referrals', name: 'Referrals' },
  { id: 'chatbot', name: 'Chatbot' },
  { id: 'partners_press', name: 'Partners and press' },
] as const;
export type ChannelId = (typeof CHANNELS)[number]['id'];
export const CHANNEL_IDS = CHANNELS.map((channel) => channel.id) as [ChannelId, ...ChannelId[]];

export const MAX_TAGS = 20;

/** Core Engine lifecycle → contact type; a linked contact's type always follows the Core Engine. */
export const typeFromLifecycle = (status: LifecycleStatus): ContactType => status;

/** A field value that breaks a rule; `field` names the input so the UI can show the error next to it. */
export class ContactFieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContactFieldError';
  }
}

/** PRD 12.4: emails are stored lower-cased and trimmed. Syntax only; mail-server checks are EML-12. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  // One "@", no spaces, a dot in the domain, 254 characters max (RFC 5321).
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContactFieldError('email', 'Enter an email address such as name@example.com');
  }
  return email;
}

/**
 * Key of the global suppression list (AUD-12, AUD-18): SHA-256 of the normalized email, so the list
 * survives erasure without keeping the address itself.
 */
export const hashEmail = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** "+374 (91) 23-45-67" → "+37491234567"; "00374…" → "+374…". Empty → null. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined || input.trim() === '') return null;
  const phone = input.replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
    throw new ContactFieldError('phone', 'Enter a phone number with the country code, such as +374 91 234567');
  }
  return phone;
}

/** Trimmed name part; empty → null. */
export function normalizeName(input: string | null | undefined): string | null {
  const name = input?.trim().replace(/\s+/g, ' ') ?? '';
  return name === '' ? null : name;
}

/** Campaign slug as in utm_campaign: lower-case letters, digits, "_" and "-". Empty → null. */
export function normalizeCampaign(input: string | null | undefined): string | null {
  const campaign = input?.trim().toLowerCase() ?? '';
  if (campaign === '') return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(campaign)) {
    throw new ContactFieldError('sourceCampaign', 'Use a campaign code such as spring_open_day_2026: letters, digits, "_" and "-"');
  }
  return campaign;
}

/**
 * Tags are lower-case, spaces become "-", a leading "#" is dropped; duplicates are removed, order kept.
 * Letters of any script are allowed, so Armenian and Russian tags work.
 */
export function normalizeTags(input: readonly string[]): string[] {
  const tags = [...new Set(input.map((tag) => tag.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw new ContactFieldError('tags', `A contact can have at most ${MAX_TAGS} tags`);
  const invalid = tags.find((tag) => !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u.test(tag));
  if (invalid !== undefined) {
    throw new ContactFieldError('tags', `"${invalid}" is not a valid tag: up to 40 letters, digits, "_" or "-"`);
  }
  return tags;
}

/** First touch cannot be in the future (a small clock skew is tolerated). */
export function normalizeFirstTouch(input: Date, now: Date): Date {
  if (Number.isNaN(input.getTime())) throw new ContactFieldError('firstTouchAt', 'Enter a valid date');
  if (input.getTime() > now.getTime() + 5 * 60_000) {
    throw new ContactFieldError('firstTouchAt', 'The first touch cannot be in the future');
  }
  return input;
}
