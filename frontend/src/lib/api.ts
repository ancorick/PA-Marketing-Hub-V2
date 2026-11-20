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

/**
 * JSON request to the backend API. Paths start with "/api/...". Sends the staff session token, except for
 * public pages (`publicFetch`), which identify the person only by the signed link token (NFR-S5).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, staff = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (staff) headers.set('Authorization', `Bearer ${staffToken()}`);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: staff ? 'include' : 'omit' });
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

/* ---------- Public pages: unsubscribe and preferences (AUD-09, AUD-11) ---------- */

export const publicFetch = <T>(path: string, init: RequestInit = {}) => apiFetch<T>(path, init, false);

export type Frequency = 'all' | 'monthly';

export type PublicPreferences = {
  email: string;
  language: Language;
  frequency: Frequency;
  topics: Topic[];
  suppressed: boolean;
};

const withToken = (path: string, token: string) => `${path}?t=${encodeURIComponent(token)}`;

export const publicUnsubscribe = (token: string) =>
  publicFetch<{ unsubscribed: true; language: Language; preferencesToken: string | null }>(withToken('/api/public/unsubscribe', token), {
    method: 'POST',
  });

export const publicUndoUnsubscribe = (token: string) =>
  publicFetch<{ unsubscribed: false }>(withToken('/api/public/unsubscribe/undo', token), { method: 'POST' });

export const getPublicPreferences = (token: string) => publicFetch<PublicPreferences>(withToken('/api/public/preferences', token));

export const savePublicPreferences = (token: string, change: { topics: Topic[]; language: Language; frequency: Frequency }) =>
  publicFetch<PublicPreferences>(withToken('/api/public/preferences', token), { method: 'PUT', body: JSON.stringify(change) });

export const publicUnsubscribeAll = (token: string) =>
  publicFetch<PublicPreferences>(withToken('/api/public/preferences/unsubscribe', token), { method: 'POST' });

export const publicConfirm = (token: string) =>
  publicFetch<{ confirmed: true; language: Language }>(withToken('/api/public/confirm', token), { method: 'POST' });

/* ---------- Audience: CSV import and duplicates (AUD-03, AUD-04) ---------- */

export const IMPORT_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'language',
  'type',
  'sourceChannel',
  'sourceCampaign',
  'firstTouchAt',
  'tags',
  'consent',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;

export type ImportOptions = {
  defaultLanguage: Language;
  defaultSourceChannel?: string;
  sourceCampaign?: string | null;
  tags?: string[];
  consentTopic?: Topic;
};

export type ImportRow = {
  line: number;
  status: 'new' | 'match' | 'duplicate_in_file' | 'invalid';
  email: string | null;
  name: string | null;
  errors: string[];
  possibleDuplicate: { contactId: string | null; line: number | null; reason: 'email_key' | 'phone' } | null;
  consent: 'granted' | 'withdrawn' | 'unknown';
};

export type ImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  totals: { rows: number; new: number; match: number; duplicate_in_file: number; invalid: number; possibleDuplicates: number };
  hasConsentColumn: boolean;
  sample: ImportRow[];
  problems: ImportRow[];
};

export type ImportRequest = { fileName: string; csv: string; mapping?: ColumnMapping; options: ImportOptions };

export const previewImport = (request: ImportRequest) =>
  apiFetch<ImportPreview>('/api/audience/imports/preview', { method: 'POST', body: JSON.stringify(request) });

export const commitImport = (request: ImportRequest) =>
  apiFetch<{ importId: string; created: number; updated: number; skipped: number; invalid: number }>('/api/audience/imports', {
    method: 'POST',
    body: JSON.stringify(request),
  });

export type DuplicateReason = 'email_key' | 'phone' | 'name';

export const listDuplicates = () => apiFetch<{ pairs: { reason: DuplicateReason; contacts: ContactDetail[] }[] }>('/api/audience/duplicates');

export const contactDuplicates = (id: string) =>
  apiFetch<{ duplicates: { reason: DuplicateReason; contact: ContactDetail }[] }>(`/api/audience/contacts/${encodeURIComponent(id)}/duplicates`);

export const dismissDuplicate = (contactA: string, contactB: string) =>
  apiFetch<void>('/api/audience/duplicates/dismiss', { method: 'POST', body: JSON.stringify({ contactA, contactB }) });

export const mergeContacts = (keepId: string, otherId: string) =>
  apiFetch<ContactDetail>(`/api/audience/contacts/${encodeURIComponent(keepId)}/merge`, { method: 'POST', body: JSON.stringify({ otherId }) });

/* ---------- Admin: scheduled jobs (AUD-06, PRD 14.4) ---------- */

export type SyncRun = {
  id: string;
  status: 'running' | 'ok' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  rowsIn: number;
  rowsUpserted: number;
  error: string | null;
  triggeredBy: string;
};

export type JobStatus = {
  name: string;
  description: string;
  intervalMinutes: number;
  running: boolean;
  lastRun: SyncRun | null;
  lastSuccessAt: string | null;
};

export const listJobs = () => apiFetch<{ jobs: JobStatus[] }>('/api/admin/jobs');

export const runJob = (name: string) => apiFetch<SyncRun>(`/api/admin/jobs/${encodeURIComponent(name)}/run`, { method: 'POST' });

/* ---------- Audience: segments (AUD-13 to AUD-15, AUD-17) ---------- */

export type TouchType = 'visit' | 'form' | 'click' | 'open' | 'registration' | 'attendance' | 'chat' | 'referral';
export type OutcomeType = 'lead' | 'applied' | 'enrolled' | 'completed' | 'hired';

export type SegmentCondition =
  | { kind: 'attribute'; field: 'type' | 'language' | 'sourceChannel' | 'sourceCampaign' | 'employmentStatus'; operator: 'in' | 'not_in'; values: string[] }
  | { kind: 'tag'; operator: 'has' | 'has_not'; value: string }
  | { kind: 'course'; operator: 'in' | 'contains'; values: string[] }
  | { kind: 'group'; operator: 'in'; values: string[] }
  | { kind: 'touch'; touchType: TouchType; operator: 'did' | 'did_not'; withinDays?: number; channel?: string; campaignContains?: string }
  | { kind: 'outcome'; outcomeType: OutcomeType; operator: 'did' | 'did_not'; withinDays?: number }
  | { kind: 'date'; field: 'firstTouchAt' | 'createdAt'; operator: 'within_days' | 'older_than_days'; days: number }
  | { kind: 'consent'; topic: Topic; state: ConsentState; olderThanDays?: number }
  | { kind: 'admissions'; operator: 'active' | 'not_active' }
  | { kind: 'referred_enrolled' };

export type SegmentRule = { op: 'and' | 'or'; conditions: (SegmentCondition | SegmentRule)[] };

export type Segment = {
  id: string;
  name: string;
  description: string | null;
  type: 'dynamic' | 'static';
  rule: SegmentRule | null;
  ownerId: string;
  lastCount: number | null;
  lastCountedAt: string | null;
  updatedAt: string;
};

export type SegmentContact = { id: string; email: string | null; firstName: string | null; lastName: string | null; type: ContactType; language: Language; status: ContactStatus };

export const listSegments = () => apiFetch<{ segments: Segment[] }>('/api/audience/segments');
export const getSegment = (id: string) => apiFetch<Segment>(`/api/audience/segments/${encodeURIComponent(id)}`);
export const createSegment = (input: { name: string; description?: string | null; type: 'dynamic' | 'static'; rule?: SegmentRule }) =>
  apiFetch<Segment>('/api/audience/segments', { method: 'POST', body: JSON.stringify(input) });
export const updateSegment = (id: string, input: { name?: string; description?: string | null; rule?: SegmentRule }) =>
  apiFetch<Segment>(`/api/audience/segments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteSegment = (id: string) => apiFetch<void>(`/api/audience/segments/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const countSegmentRule = (rule: SegmentRule) =>
  apiFetch<{ count: number; sample: SegmentContact[] }>('/api/audience/segments/count', { method: 'POST', body: JSON.stringify({ rule }) });
export const listSegmentMembers = (id: string, offset = 0) =>
  apiFetch<{ total: number; contacts: SegmentContact[] }>(`/api/audience/segments/${encodeURIComponent(id)}/members?limit=25&offset=${offset}`);
export const addSegmentMembers = (id: string, emails: string[]) =>
  apiFetch<{ added: number; notFound: string[] }>(`/api/audience/segments/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify({ emails }) });
export const removeSegmentMembers = (id: string, contactIds: string[]) =>
  apiFetch<{ removed: number }>(`/api/audience/segments/${encodeURIComponent(id)}/members`, { method: 'DELETE', body: JSON.stringify({ contactIds }) });

export type AudienceBreakdown = { matching: number; notReachable: number; noConsent: number; activeAdmissions: number; eligible: number };
export const segmentBreakdown = (id: string, topic?: Topic, excludeActiveAdmissions = true) =>
  apiFetch<AudienceBreakdown>(
    `/api/audience/segments/${encodeURIComponent(id)}/breakdown?excludeActiveAdmissions=${excludeActiveAdmissions}${topic ? `&topic=${topic}` : ''}`,
  );
