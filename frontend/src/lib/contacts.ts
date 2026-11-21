import type { Contact, ContactStatus, ContactType, Language } from './api';
import type { Tone } from '../ui';

export const LANGUAGE_LABEL: Record<Language, string> = { hy: 'Armenian', en: 'English', ru: 'Russian' };

export const TYPE_LABEL: Record<ContactType, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  applicant: 'Applicant',
  student: 'Student',
  alumnus: 'Alumnus',
};

export const STATUS: Record<ContactStatus, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  unsubscribed: { tone: 'neutral', label: 'Unsubscribed' },
  bounced: { tone: 'danger', label: 'Bounced' },
  complained: { tone: 'danger', label: 'Complained' },
  erased: { tone: 'neutral', label: 'Erased' },
};

export const options = <K extends string>(labels: Record<K, string>) =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

/** "Anna Petrosyan", or null when the contact has no name. */
export function fullName(contact: Pick<Contact, 'firstName' | 'lastName'>): string | null {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  return name === '' ? null : name;
}

/** Calendar date in Yerevan, the Academy's calendar: "2026-03-01". Matches what the API reads back. */
export function yerevanDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(new Date(iso));
}

export const contactPath = (id: string) => `#/contacts/${encodeURIComponent(id)}`;

export const TOPIC_LABEL: Record<import('./api').Topic, string> = {
  newsletter: 'Newsletter',
  courses: 'Courses',
  events: 'Events',
  alumni: 'Alumni',
};

export const CONSENT: Record<import('./api').ConsentState, { tone: Tone; label: string }> = {
  granted: { tone: 'success', label: 'Granted' },
  withdrawn: { tone: 'danger', label: 'Withdrawn' },
  pending: { tone: 'warning', label: 'Awaiting confirmation' },
  unknown: { tone: 'neutral', label: 'Unknown' },
};

export const SUPPRESSION_LABEL: Record<import('./api').SuppressionReason, string> = {
  unsubscribed: 'Unsubscribed',
  hard_bounce: 'Hard bounce',
  complaint: 'Spam complaint',
  erased: 'Erased',
};

export const DUPLICATE_REASON: Record<import('./api').DuplicateReason, string> = {
  email_key: 'Same email apart from dots or a +tag',
  phone: 'Same phone number',
  name: 'Similar name and email',
};
