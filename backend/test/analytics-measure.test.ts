import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

/* RESTRUCTURE R3, group MEASURE: data added for the Overview, Cohorts, Costs and Campaigns & links pages. */

const at = (day: string) => new Date(`${day}T10:00:00+04:00`);
let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

let seq = 0;
async function person(channel: 'paid_social' | 'events' | null, firstTouch: string, stages: [type: 'lead' | 'applied' | 'enrolled' | 'completed' | 'hired', day: string][]) {
  seq += 1;
  const { db } = await currentTestDatabase();
  if (channel === null) {
    // A person the Core Engine knows but no contact links to: no recorded touch, so unattributed.
    for (const [type, day] of stages) await db.insert(outcomes).values({ contactId: null, corePersonId: `core-${seq}`, type, occurredAt: at(day), sourceSystem: 'test', sourceRef: `${type}${seq}` });
    return null;
  }
  const contact = await app.contacts.create({ email: `m${seq}@example.test`, language: 'en', sourceChannel: channel, firstTouchAt: at(firstTouch) }, { userId: 'test' });
  for (const [type, day] of stages) await db.insert(outcomes).values({ contactId: contact.id, type, occurredAt: at(day), sourceSystem: 'test', sourceRef: `${type}${seq}` });
  return contact.id;
}

const get = (url: string, role = 'marketing_manager') => app.inject({ method: 'GET', url, headers: bearer(role) });

describe('Overview for the MEASURE pages', () => {
  it('adds completed, a weekly trend and the trust block', async () => {
    await person('paid_social', '2026-10-05', [['lead', '2026-10-05'], ['applied', '2026-10-07'], ['enrolled', '2026-10-20'], ['completed', '2026-10-28']]);
    await person('events', '2026-10-06', [['lead', '2026-10-06'], ['enrolled', '2026-10-21']]);
    await person(null, '2026-10-14', [['lead', '2026-10-14']]);
    const body = (await get('/api/analytics/overview?from=2026-10-01&to=2026-10-31&model=last_touch')).json();
    expect(body.view).toBe('period');
    expect(body.totals).toMatchObject({ lead: 3, applied: 1, enrolled: 2, completed: 1 });
    expect(body.trend.granularity).toBe('week');
    // Weeks start on Monday: 28 Sep … 26 Oct.
    expect(body.trend.points.map((point: { start: string }) => point.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(body.trend.points.reduce((sum: number, point: { lead: number }) => sum + point.lead, 0)).toBe(3);
    expect(body.trend.points.find((point: { start: string }) => point.start === '2026-10-19').enrolled).toBe(2);
    expect(body.trust).toMatchObject({ enrolled: 2, attributedEnrolled: 2, unattributed: { lead: 1, enrolled: 0 } });
  });

  it('counts later outcomes of the people first reached in the range in the cohort view', async () => {
    await person('paid_social', '2026-09-20', [['lead', '2026-09-20'], ['enrolled', '2026-11-10']]);
    await person('paid_social', '2026-08-01', [['lead', '2026-09-25']]);
    const period = (await get('/api/analytics/overview?from=2026-09-01&to=2026-09-30')).json();
    const cohort = (await get('/api/analytics/overview?from=2026-09-01&to=2026-09-30&view=cohort')).json();
    expect(period.totals).toMatchObject({ lead: 2, enrolled: 0 });
    expect(cohort).toMatchObject({ view: 'cohort', totals: { lead: 1, enrolled: 1 } });
    expect((await get('/api/analytics/overview?from=2026-09-01&to=2026-09-30&view=week')).statusCode).toBe(400);
  });

  it('gives a provisional cost per hired graduate for maturing cohorts', async () => {
    const body = (await get('/api/analytics/cohorts?model=first_touch')).json();
    const latest = body.cohorts[0];
    expect(latest.maturing).toBe(true);
    expect(latest).toHaveProperty('costPerHiredSoFar');
    expect(latest.costPerHired).toBeNull();
  });
});

describe('Costs page data', () => {
  const manual = { channel: 'events', campaign: 'Open day', description: 'Venue and catering', dateFrom: '2026-10-20', dateTo: '2026-10-20', amount: 150_000, currency: 'AMD' };

  it('lists ad spend and manual costs as entries with their source, and spend per week', async () => {
    await app.inject({ method: 'POST', url: '/api/analytics/costs', headers: bearer('marketing_manager'), payload: manual });
    await app.pipeline.pull('meta_ads', { from: '2026-10-18', to: '2026-10-21' });
    const { entries } = (await get('/api/analytics/costs/entries?from=2026-10-01&to=2026-10-31', 'leadership')).json();
    const own = entries.find((entry: { source: string }) => entry.source === 'manual');
    expect(own).toMatchObject({ channel: 'events', campaign: 'open-day', amountAmd: 150_000, note: 'Venue and catering' });
    expect(own.manualId).toBe(own.id);
    const ad = entries.find((entry: { source: string }) => entry.source === 'api');
    expect(ad).toMatchObject({ channel: 'paid_social', manualId: null });
    expect(ad.campaignName).toMatch(/^Meta Ads · /);
    expect(ad.note).toMatch(/impressions, \d+ clicks$/);
    expect(entries.map((entry: { dateFrom: string }) => entry.dateFrom)).toEqual([...entries.map((entry: { dateFrom: string }) => entry.dateFrom)].sort().reverse());

    const costs = (await get('/api/analytics/costs?from=2026-10-01&to=2026-10-31')).json();
    expect(costs.trend.granularity).toBe('week');
    const total = costs.trend.points.reduce((sum: number, point: { channels: Record<string, number> }) => sum + Object.values(point.channels).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(costs.channels.reduce((sum: number, row: { totalAmd: number }) => sum + row.totalAmd, 0));
    expect((await get('/api/analytics/costs?from=2025-11-01&to=2026-10-31')).json().trend.points).toHaveLength(12);
  });

  it('stores exchange rates entered by managers and converts new costs with them', async () => {
    const save = (payload: Record<string, unknown>, role = 'marketing_manager') => app.inject({ method: 'POST', url: '/api/analytics/rates', headers: bearer(role), payload });
    expect((await save({ currency: 'USD', date: '2026-10-01', rateToAmd: 390 }, 'editor')).statusCode).toBe(403);
    expect((await save({ currency: 'XYZ', date: '2026-10-01', rateToAmd: 390 })).json()).toMatchObject({ field: 'currency' });
    expect((await save({ currency: 'USD', date: '2026-10-01', rateToAmd: 0 })).json()).toMatchObject({ field: 'rateToAmd' });
    expect((await save({ currency: 'usd', date: '2026-10-01', rateToAmd: 390 })).statusCode).toBe(201);

    const list = (await get('/api/analytics/rates', 'viewer')).json();
    expect(list.latest.find((rate: { currency: string }) => rate.currency === 'USD')).toMatchObject({ rateToAmd: 390, date: '2026-10-01', origin: 'manual' });
    expect(list.latest.find((rate: { currency: string }) => rate.currency === 'EUR')).toMatchObject({ origin: 'cba' });

    const after = await app.inject({ method: 'POST', url: '/api/analytics/costs', headers: bearer('marketing_manager'), payload: { ...manual, amount: 100, currency: 'USD' } });
    expect(after.json()).toMatchObject({ amountAmd: 39_000, rateToAmd: 390 });
    // Before the stored rate's date the rate client still answers.
    const before = await app.inject({ method: 'POST', url: '/api/analytics/costs', headers: bearer('marketing_manager'), payload: { ...manual, dateFrom: '2026-09-01', dateTo: '2026-09-01', amount: 100, currency: 'USD' } });
    expect(before.json()).toMatchObject({ rateToAmd: 387.5 });
  });
});

describe('Campaign list (Campaigns & links)', () => {
  const post = (payload: Record<string, unknown>, role = 'marketing_manager') => app.inject({ method: 'POST', url: '/api/analytics/campaign-registry', headers: bearer(role), payload });

  it('creates campaigns with a budget and lists keys seen in links and costs', async () => {
    const created = await post({ name: 'Spring intake 2027', channel: 'paid_social', dateFrom: '2027-01-20', dateTo: '2027-04-30', budgetAmd: 3_300_000 });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ key: 'spring-intake-2027', name: 'Spring intake 2027', budgetAmd: 3_300_000, registered: true });
    expect((await post({ name: 'Spring intake 2027', channel: 'paid_social' })).statusCode).toBe(409);
    expect((await post({ name: 'Other', channel: 'billboards' })).json()).toMatchObject({ field: 'channel' });
    expect((await post({ name: 'Other', channel: 'email', dateFrom: '2026-10-02', dateTo: '2026-10-01' })).json()).toMatchObject({ field: 'dateTo' });
    expect((await post({ name: 'By an editor', channel: 'email' }, 'editor')).statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/api/analytics/costs', headers: bearer('marketing_manager'), payload: { channel: 'events', campaign: 'open-day-dec', description: 'Venue', dateFrom: '2026-12-05', dateTo: '2026-12-05', amount: 90_000, currency: 'AMD' } });
    const { campaigns } = (await get('/api/analytics/campaign-registry', 'editor')).json();
    expect(campaigns.find((row: { key: string }) => row.key === 'open-day-dec')).toMatchObject({ registered: false, channel: 'events', dateFrom: '2026-12-05', seenIn: ['costs'], budgetAmd: null });
    expect((await get('/api/analytics/campaign-registry', 'leadership')).statusCode).toBe(403);

    // Saving a key seen elsewhere gives it a name and a budget.
    const saved = await app.inject({ method: 'PUT', url: '/api/analytics/campaign-registry/open-day-dec', headers: bearer('admin'), payload: { name: 'Open day · December', channel: 'events', budgetAmd: 120_000 } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ key: 'open-day-dec', name: 'Open day · December', registered: true, budgetAmd: 120_000, seenIn: ['costs'] });
  });

  it('gives every channel a group and a default source for the taxonomy table', async () => {
    const { channels } = (await get('/api/analytics/links', 'editor')).json();
    expect(channels.find((row: { id: string }) => row.id === 'paid_social')).toMatchObject({ group: 'paid', medium: 'paid_social', defaultSource: 'instagram' });
    expect(channels.find((row: { id: string }) => row.id === 'events')).toMatchObject({ group: 'offline', medium: 'offline' });
  });
});
