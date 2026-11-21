import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAnalyticsSources, MockAdPlatformClient } from '../src/analytics/sources/mock.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, testConfig } from './helpers.js';

let app: FastifyInstance;
let outbox: LogEmailAdapter;
let ads: MockAdPlatformClient;
beforeEach(async () => {
  const sources = createMockAnalyticsSources();
  ads = sources.ads[0] as MockAdPlatformClient;
  outbox = new LogEmailAdapter({ info: () => {} });
  app = await buildTestApp({ analyticsSources: sources, email: outbox, config: testConfig({ ADMIN_ALERT_EMAILS: 'ops@academy.example' }) });
});
afterEach(() => app.close());

const alertsFor = async (role: string) => (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer(role) })).json().alerts as { level: string; title: string }[];

describe('Data Health (ANL-11)', () => {
  it('alerts the admin in Slack and by email when a source fails twice in a row, once per streak', async () => {
    ads.failNext = 3;
    await app.jobs.run('meta_ads', 'scheduler');
    expect((await alertsFor('admin')).map((alert) => alert.level)).toEqual(['warning']);
    expect(outbox.outbox).toHaveLength(0);

    await app.jobs.run('meta_ads', 'scheduler');
    const alerts = await alertsFor('admin');
    expect(alerts.find((alert) => alert.level === 'critical')?.title).toBe('Failing twice in a row: Ad platform spend (meta_ads)');
    expect(outbox.outbox).toHaveLength(1);
    expect(outbox.outbox[0]).toMatchObject({ to: 'ops@academy.example', subject: 'Data source failing: Ad platform spend (meta_ads)' });

    await app.jobs.run('meta_ads', 'scheduler'); // third failure: no new email
    expect(outbox.outbox).toHaveLength(1);

    const health = await app.inject({ method: 'GET', url: '/api/analytics/health', headers: bearer('admin') });
    expect(health.statusCode).toBe(200);
    const source = health.json().sources.find((item: { name: string }) => item.name === 'meta_ads');
    expect(source).toMatchObject({ kind: 'external', status: 'failing', consecutiveFailures: 3, lastSuccessAt: null, schedule: 'nightly 03:00 Yerevan' });
    expect(source.lastRun.error).toBe('meta_ads: 401 invalid access token');
    expect(source.recentRuns).toHaveLength(3);
  });

  it('shows freshness, row counts and unmapped values; recovers after a successful pull', async () => {
    ads.failNext = 1;
    await app.jobs.run('meta_ads', 'scheduler');
    await app.jobs.run('meta_ads', 'scheduler');
    await app.jobs.run('website_analytics', 'scheduler');
    const body = (await app.inject({ method: 'GET', url: '/api/analytics/health', headers: bearer('marketing_manager') })).json();
    const meta = body.sources.find((item: { name: string }) => item.name === 'meta_ads');
    expect(meta).toMatchObject({ status: 'ok', consecutiveFailures: 0, lastSuccessAt: expect.any(String) });
    expect(body.sources.find((item: { name: string }) => item.name === 'google_ads')).toMatchObject({ status: 'never_run' });
    expect(body.sources.find((item: { name: string }) => item.name === 'crm_leads')).toMatchObject({ kind: 'internal' });
    expect(body.tables.adSpend).toBeGreaterThan(0);
    expect(body.unmapped).toEqual([{ source: 'website_analytics', count: 1 }]);
    expect((await app.inject({ method: 'GET', url: '/api/analytics/health', headers: bearer('editor') })).statusCode).toBe(403);
  });
});
