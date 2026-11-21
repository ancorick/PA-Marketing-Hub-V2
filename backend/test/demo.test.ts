import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { DEMO_CONTACTS, DEMO_MONTHS, generateDemoData } from '../src/demo/generate.js';
import { seedDemoData } from '../src/demo/seed.js';
import { contacts } from '../src/db/schema.js';
import { buildTestApp, currentTestDatabase } from './helpers.js';

const NOW = new Date('2026-11-22T09:30:00.000Z');
const bearer = (role: string) => ({ authorization: `Bearer mock-${role}` });
const DAY = 86_400_000;

describe('demo data generator (RESTRUCTURE R2)', () => {
  const data = generateDemoData({ now: NOW });

  it('gives identical rows for the same moment', () => {
    expect(JSON.stringify(generateDemoData({ now: NOW }))).toBe(JSON.stringify(data));
  });

  it('has about 1,800 contacts of every type, in three languages, over 18 months', () => {
    expect(data.contacts).toHaveLength(DEMO_CONTACTS);
    expect(new Set(data.contacts.map((row) => row.language))).toEqual(new Set(['hy', 'en', 'ru']));
    expect(new Set(data.contacts.map((row) => row.type))).toEqual(new Set(['subscriber', 'lead', 'applicant', 'student', 'alumnus']));
    const months = new Set(data.contacts.map((row) => (row.firstTouchAt as Date).toISOString().slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(DEMO_MONTHS - 1);
    expect(data.contacts.every((row) => (row.firstTouchAt as Date) < NOW)).toBe(true);
    // Synthetic only: every address is on a domain reserved for examples (RFC 2606).
    expect(data.contacts.every((row) => /@(example\.(com|org|net)|[a-z]+\.example\.test)$/.test(row.email as string))).toBe(true);
    expect(new Set(data.contacts.map((row) => row.email)).size).toBe(DEMO_CONTACTS);
    expect(data.consentRecords.length).toBeGreaterThan(DEMO_CONTACTS);
    expect(data.contacts.filter((row) => row.status !== 'active').length).toBeGreaterThan(20);
  });

  it('has the outcomes, costs, events, newsletter and sends the pages need', () => {
    const stages = new Set(data.outcomes.map((row) => row.type));
    expect(stages).toEqual(new Set(['lead', 'applied', 'enrolled', 'completed', 'hired']));
    expect(new Set(data.adSpendDaily.map((row) => row.platform))).toEqual(new Set(['meta_ads', 'google_ads']));
    expect(new Set(data.manualCosts.map((row) => row.currency))).toEqual(new Set(['AMD', 'USD', 'EUR']));
    expect(data.appSettings.find((row) => row.key === 'exchange_rates')).toBeDefined();
    expect(data.events.length).toBeGreaterThanOrEqual(15);
    expect(data.events.some((row) => (row.startsAt as Date) > NOW)).toBe(true);
    expect(data.eventRegistrations.some((row) => row.checkedInAt)).toBe(true);
    expect(data.issues.map((row) => row.language).sort()).toEqual(['en', 'hy', 'ru']);
    const campaigns = data.sends.filter((row) => row.kind === 'campaign' && row.status === 'sent');
    expect(campaigns.length).toBeGreaterThanOrEqual(3);
    expect(campaigns.length).toBeLessThanOrEqual(5);
    for (const send of data.sends.filter((row) => row.status === 'sent')) {
      const mine = data.deliveries.filter((row) => row.sendId === send.id);
      expect(mine.length, send.name).toBeGreaterThan(0);
      expect(mine.some((row) => row.firstClickAt), send.name).toBe(true);
    }
    expect(data.deliveries.some((row) => row.status === 'bounced_hard')).toBe(true);
    expect(data.deliveries.some((row) => row.unsubscribedAt)).toBe(true);
    const open = data.alerts.filter((row) => !row.resolvedAt);
    expect(open.length).toBeGreaterThanOrEqual(4);
    expect(open.length).toBeLessThanOrEqual(5);
    expect(data.unmappedValues.filter((row) => !row.resolvedAt).length).toBeGreaterThanOrEqual(3);
    expect(data.syncRuns.length).toBeGreaterThan(30);
    expect(data.auditEvents.length).toBeGreaterThan(20);
  });
});

describe('DEMO_SEED flag', () => {
  it('can never be enabled in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', LINK_SIGNING_SECRET: 's'.repeat(32), DEMO_SEED: 'true' })).toThrow(/DEMO_SEED/);
    expect(loadConfig({ NODE_ENV: 'production', LINK_SIGNING_SECRET: 's'.repeat(32) }).demoSeed).toBe(false);
    expect(loadConfig({ DEMO_SEED: 'true' }).demoSeed).toBe(true);
    expect(loadConfig({}).demoSeed).toBe(false);
  });
});

describe('seedDemoData', () => {
  it('loads the set into an empty database once, and the pages show it', async () => {
    const app = await buildTestApp();
    const database = await currentTestDatabase();
    await expect(seedDemoData(database.db, { nodeEnv: 'production' })).rejects.toThrow(/production/);

    const result = await seedDemoData(database.db, { nodeEnv: 'test' });
    expect(result.status).toBe('seeded');
    expect(await seedDemoData(database.db, { nodeEnv: 'test' })).toEqual({ status: 'skipped', reason: 'the demo data set is already loaded' });

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
    const overview = (await app.inject({ method: 'GET', url: `/api/analytics/overview?from=${from}&to=${today}&model=first_touch`, headers: bearer('marketing_manager') })).json();
    expect(overview.tiles.subscribers).toBeGreaterThan(500);
    expect(overview.tiles.newsletterClickRate.rate).toBeGreaterThan(0);
    expect(overview.totals.enrolled).toBeGreaterThan(20);
    expect(overview.totals.costAmd).toBeGreaterThan(1_000_000);

    const cohorts = (await app.inject({ method: 'GET', url: '/api/analytics/cohorts', headers: bearer('marketing_manager') })).json();
    expect(cohorts.cohorts.filter((row: { people: number }) => row.people > 0).length).toBeGreaterThanOrEqual(DEMO_MONTHS - 1);
    expect(cohorts.cohorts.some((row: { maturing: boolean }) => !row.maturing)).toBe(true);

    const health = (await app.inject({ method: 'GET', url: '/api/analytics/health', headers: bearer('admin') })).json();
    const status = Object.fromEntries(health.sources.map((source: { name: string; status: string }) => [source.name, source.status]));
    expect(status).toMatchObject({ meta_ads: 'failing', alumni_referrals: 'stale', google_ads: 'ok', crm_leads: 'ok' });
    expect(health.unmapped.length).toBeGreaterThan(0);

    const alerts = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer('admin') })).json();
    expect(alerts.alerts.filter((alert: { resolvedAt: string | null }) => !alert.resolvedAt).length).toBeGreaterThanOrEqual(4);

    const events = (await app.inject({ method: 'GET', url: `/api/events?from=${from}&to=${today}`, headers: bearer('marketing_manager') })).json();
    expect(events.totals.attendees).toBeGreaterThan(50);

    const sends = (await app.inject({ method: 'GET', url: '/api/email/sends', headers: bearer('marketing_manager') })).json();
    expect(sends.sends.filter((send: { status: string }) => send.status === 'sent').length).toBeGreaterThanOrEqual(6);

    const segments = (await app.inject({ method: 'GET', url: '/api/audience/segments', headers: bearer('marketing_manager') })).json();
    expect(segments.segments.every((segment: { lastCount: number | null }) => (segment.lastCount ?? 0) > 0)).toBe(true);

    const metrics = (await app.inject({ method: 'GET', url: '/api/analytics/metrics', headers: bearer('admin') })).json();
    expect(metrics.metrics.filter((metric: { status: string }) => metric.status === 'no_data').map((metric: { id: string }) => metric.id)).toEqual(['M11']);
    // Only the duplicates planted on purpose (AUD-04): the duplicate rate stays under the 1% target.
    expect(metrics.metrics.find((metric: { id: string }) => metric.id === 'M3').status).toBe('meets');

    const archive = (await app.inject({ method: 'GET', url: '/api/public/newsletter' })).json();
    expect(JSON.stringify(archive)).toContain('-hy');
  }, 120_000);

  it('leaves a database that already has contacts alone', async () => {
    await buildTestApp();
    const database = await currentTestDatabase();
    await database.db.insert(contacts).values({ email: 'real.person@example.org', language: 'en', type: 'subscriber', firstTouchAt: new Date() });
    const result = await seedDemoData(database.db, { nodeEnv: 'development' });
    expect(result.status).toBe('skipped');
  });
});
