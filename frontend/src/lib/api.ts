import { API_URL } from './config';
import { staffToken } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null,
    /** Machine-readable code from the API body, e.g. "invalid_domain". */
    readonly code: string | null = null,
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
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      body?.message ?? `${init.method ?? 'GET'} ${path} failed with ${response.status}`,
      requestId,
      body?.error ?? null,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type Health = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unavailable' | 'not_configured';
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
  warmupStage: number;
  esp: { provider: string; placeholder: boolean };
  records: DomainRecord[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export const listDomains = () => apiFetch<{ domains: SendingDomain[] }>('/api/email/domains');

export const addDomain = (domain: string) =>
  apiFetch<SendingDomain>('/api/email/domains', { method: 'POST', body: JSON.stringify({ domain }) });

export const verifyDomain = (id: string) =>
  apiFetch<SendingDomain>(`/api/email/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' });

export const removeDomain = (id: string) =>
  apiFetch<void>(`/api/email/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
