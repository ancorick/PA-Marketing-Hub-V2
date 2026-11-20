import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** JSON request to the backend API. Paths start with "/api/...". */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) {
    throw new ApiError(response.status, `${init.method ?? 'GET'} ${path} failed with ${response.status}`, requestId);
  }
  return (await response.json()) as T;
}

export type Health = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unavailable' | 'not_configured';
  email: { adapter: string };
  integrations: { mode: string; coreEngine: string; navigatorCrm: string; alumniTracker: string };
};

export const getHealth = () => apiFetch<Health>('/api/health');
