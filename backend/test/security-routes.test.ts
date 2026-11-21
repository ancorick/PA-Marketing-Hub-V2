import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

/**
 * NFR-S1: role checks run on every API endpoint, not only in the interface. Every route is called without a
 * session; only the routes listed here may answer without one, each for a stated reason.
 */
const PUBLIC: [RegExp, string][] = [
  [/^\/api\/health/, 'health check for Render'],
  [/^\/api\/public\//, 'pages for contacts: signed link tokens or rate-limited forms (NFR-S5, NFR-S6)'],
  [/^\/api\/webhooks\//, 'signed webhooks (NFR-S4)'],
  [/^\/api\/sandbox\/event-hub\//, 'signed sandbox and synthetic fixtures (EVT-08)'],
  [/^\/api\/v1\/command-center\//, 'service API key (ANL-13)'],
  [/^\/api\/integrations\/event-hub\//, 'service API key (EVT-07)'],
  [/^\/l\//, 'short links of the link builder (ANL-04)'],
];

const fill = (url: string) => url.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000').replace(/\*$/, 'x');

describe('every staff route checks the session (NFR-S1)', () => {
  it('answers 401 without a token, and the public exceptions are deliberate', async () => {
    const app = await buildTestApp();
    const unprotected: string[] = [];
    const exceptions = new Set<string>();
    for (const route of app.routeList) {
      const reason = PUBLIC.find(([pattern]) => pattern.test(route.url));
      if (reason) {
        exceptions.add(reason[1]);
        continue;
      }
      if (route.method === 'OPTIONS') continue;
      const body = route.method === 'GET' || route.method === 'DELETE' ? {} : { headers: { 'content-type': 'application/json' }, payload: '{}' };
      const response = await app.inject({ method: route.method as 'GET', url: fill(route.url), ...body });
      if (response.statusCode !== 401) unprotected.push(`${route.method} ${route.url} → ${response.statusCode}`);
      const forged = await app.inject({ method: route.method as 'GET', url: fill(route.url), ...body, headers: { ...('headers' in body ? body.headers : {}), authorization: 'Bearer forged-token' } });
      if (forged.statusCode !== 401) unprotected.push(`${route.method} ${route.url} with a forged token → ${forged.statusCode}`);
    }
    expect(unprotected).toEqual([]);
    // Every exception is in use (a stale one would hide a future unprotected route).
    expect(exceptions.size).toBe(PUBLIC.length);
    expect(app.routeList.length).toBeGreaterThan(100);
    await app.close();
  });
});
