import { API_URL } from './config';
import { staffToken } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null,
    /** Machine-readable code from the API body, e.g. "invalid_domain". */
    readonly code: string | null = null,
    /** Extra error fields: the input to fix (`field`) or the record that already exists (`existingId`). */
    readonly details: { field?: string | null; existingId?: string | null } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** JSON request to the backend API. Paths start with "/api/...". Sends the staff session token. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${staffToken()}`);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) {
    // The API answers errors as {error, message}; the message is written for staff.
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
      field?: string | null;
      existingId?: string | null;
    } | null;
    throw new ApiError(
      response.status,
      body?.message ?? `${init.method ?? 'GET'} ${path} failed with ${response.status}`,
      requestId,
      body?.error ?? null,
      { field: body?.field, existingId: body?.existingId },
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type Health = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unavailable' | 'embedded';
  email: { adapter: string };
  integrations: { mode: string; coreEngine: string; navigatorCrm: string; alumniTracker: string };
};

export const getHealth = () => apiFetch<Health>('/api/health');

/* ---------- Email settings: sending domains (EML-02, EML-03) ---------- */

export type DnsRecordKind = 'spf' | 'dkim' | 'dmarc' | 'tracking';
export type CheckStatus = 'pending' | 'verified' | 'missing' | 'invalid' | 'error';

export type DomainRecord = {
  kind: DnsRecordKind;
  type: 'TXT' | 'CNAME';
  host: string;
  value: string;
  requiredForSending: boolean;
  status: CheckStatus;
  found: string[];
  problems: string[];
};

export type SendingDomain = {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'action_needed';
  canSendMarketing: boolean;
  blockedReason: string | null;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | null;
  warmup: Warmup;
  esp: { provider: string; placeholder: boolean };
  records: DomainRecord[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

/** EML-08: the plan, today's cap and how much of it is used. */
export type Warmup = {
  status: 'not_started' | 'active' | 'complete' | 'skipped';
  days: number;
  day: number | null;
  todayCap: number | null;
  sentToday: number;
  plan: number[];
  startedAt: string | null;
  skippedAt: string | null;
};

export type WarmupLength = 14 | 21 | 28;

export const listDomains = () => apiFetch<{ domains: SendingDomain[] }>('/api/email/domains');

export const addDomain = (domain: string) =>
  apiFetch<SendingDomain>('/api/email/domains', { method: 'POST', body: JSON.stringify({ domain }) });

export const verifyDomain = (id: string) =>
  apiFetch<SendingDomain>(`/api/email/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' });

export const updateWarmup = (id: string, change: { days: WarmupLength } | { skip: true }) =>
  apiFetch<SendingDomain>(`/api/email/domains/${encodeURIComponent(id)}/warmup`, {
    method: 'PATCH',
    body: JSON.stringify(change),
  });

export const removeDomain = (id: string) =>
  apiFetch<void>(`/api/email/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ---------- Audience: contacts (AUD-01, AUD-02) ---------- */

export type Language = 'hy' | 'en' | 'ru';
export type ContactType = 'subscriber' | 'lead' | 'applicant' | 'student' | 'alumnus';
export type ContactStatus = 'active' | 'unsubscribed' | 'bounced' | 'complained' | 'erased';

export type Contact = {
  id: string;
  corePersonId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  language: Language;
  type: ContactType;
  /** core_engine: the type mirrors the Core Engine lifecycle and is not editable here. */
  typeSource: 'core_engine' | 'marketing_hub';
  sourceChannel: string | null;
  sourceCampaign: string | null;
  firstTouchAt: string;
  tags: string[];
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContactDetail = Contact & {
  history: { action: string; actorId: string; fields: string[]; at: string }[];
};

export type ContactPage = { contacts: Contact[]; total: number; limit: number; offset: number };

export type ContactFilters = {
  q?: string;
  type?: ContactType;
  language?: Language;
  tag?: string;
  limit?: number;
  offset?: number;
};

/** What staff can set; `firstTouchAt` is a date ("2026-03-01") or an ISO date-time. */
export type ContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  language: Language;
  type?: ContactType;
  sourceChannel: string;
  sourceCampaign?: string | null;
  firstTouchAt?: string;
  tags?: string[];
  corePersonId?: string;
};

export type Channel = { id: string; name: string };

export const listChannels = () => apiFetch<{ channels: Channel[] }>('/api/audience/channels');

export function listContacts(filters: ContactFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return apiFetch<ContactPage>(`/api/audience/contacts${query ? `?${query}` : ''}`);
}

export const getContact = (id: string) => apiFetch<ContactDetail>(`/api/audience/contacts/${encodeURIComponent(id)}`);

export const createContact = (input: ContactInput) =>
  apiFetch<Contact>('/api/audience/contacts', { method: 'POST', body: JSON.stringify(input) });

export const updateContact = (id: string, changes: Partial<ContactInput>) =>
  apiFetch<Contact>(`/api/audience/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });

/* ---------- Audience: consent and suppression (AUD-07, AUD-12) ---------- */

export type Topic = 'newsletter' | 'courses' | 'events' | 'alumni';
export type ConsentState = 'granted' | 'withdrawn' | 'unknown' | 'pending';
export type SuppressionReason = 'unsubscribed' | 'hard_bounce' | 'complaint' | 'erased';

export type ConsentView = {
  topics: { topic: Topic; state: ConsentState; method: string | null; wordingVersion: string | null; since: string | null }[];
  suppressed: { reason: SuppressionReason; source: string; since: string }[];
  history: {
    id: string;
    topic: Topic;
    state: ConsentState;
    method: string;
    wordingVersion: string | null;
    sourceUrl: string | null;
    actorId: string | null;
    reason: string | null;
    at: string;
  }[];
};

export const getConsent = (contactId: string) =>
  apiFetch<ConsentView>(`/api/audience/contacts/${encodeURIComponent(contactId)}/consent`);

export const changeConsent = (contactId: string, change: { topics: Topic[]; state: 'granted' | 'withdrawn'; reason: string }) =>
  apiFetch<ConsentView>(`/api/audience/contacts/${encodeURIComponent(contactId)}/consent`, {
    method: 'POST',
    body: JSON.stringify(change),
  });

export const unsubscribeContact = (contactId: string, reason: string) =>
  apiFetch<ConsentView>(`/api/audience/contacts/${encodeURIComponent(contactId)}/unsubscribe`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const getSuppressionSummary = () => apiFetch<{ active: Record<SuppressionReason, number> }>('/api/audience/suppressions/summary');
