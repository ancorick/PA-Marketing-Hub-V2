import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DetailService } from '../src/analytics/detail.js';
import { outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

const at = (day: string) => new Date(`${day}T10:00:00+04:00`);
let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

let seq = 0;
async function person(channel: 'paid_social' | 'events', firstTouch: string, campaign: string | null, stages: [string, string][]) {
  seq += 1;
  const contact = await app.contacts.create({ email: `d${seq}@example.test`, language: 'en', sourceChannel: channel, sourceCampaign: campaign, firstTouchAt: at(firstTouch) }, { userId: 'test' });
  const { db } = await currentTestDatabase();
  for (const [type, day] of stages) await db.insert(outcomes).values({ contactId: contact.id, type, occurredAt: at(day), sourceSystem: 'test', sourceRef: `${type}${seq}` });
  return contact.id;
}

describe('channel, campaign and cohort views (ANL-09, ANL-10)', () => {
  it('channel detail: funnel, campaigns inside it and a 12-month trend', async () => {
    for (let i = 0; i < 3; i += 1) await person('paid_social', '2026-09-02', 'autumn-intake', [['lead', '2026-09-02'], ['applied', '2026-09-10'], ['enrolled', '2026-10-01']]);
    await person('paid_social', '2026-09-03', 'open-day', [['lead', '2026-09-03']]);
    await person('events', '2026-09-03', null, [['lead', '2026-09-03']]);
    await app.costs.create({ channel: 'paid_social', campaign: 'autumn-intake', description: 'Agency', dateFrom: '2026-09-01', dateTo: '2026-10-31', amount: 610_000, currency: 'AMD' }, 'test');

    const response = await app.inject({ method: 'GET', url: '/api/analytics/channels/paid_social?from=2026-09-01&to=2026-10-31&model=first_touch', headers: bearer('marketing_manager') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.funnel).toEqual({ lead: 4, applied: 3, enrolled: 3, completed: 0, hired: 0 });
    expect(body).toMatchObject({ costAmd: 610_000, costPerEnrolled: 203_333, modelLabel: 'First touch' });
    expect(body.campaigns.find((row: { campaign: string }) => row.campaign === 'autumn-intake')).toMatchObject({ lead: 3, enrolled: 3, costAmd: 610_000, costPerEnrolled: 203_333 });
    expect(body.campaigns.find((row: { campaign: string }) => row.campaign === 'open-day')).toMatchObject({ lead: 1, costAmd: 0 });
    expect(body.trend).toHaveLength(12);
    expect(body.trend.at(-1)).toMatchObject({ month: '2026-10', enrolled: 3, costAmd: Math.round((610_000 * 31) / 61) });
    expect(body.trend.at(-2)).toMatchObject({ month: '2026-09', lead: 4 });

    const campaign = await app.inject({ method: 'GET', url: '/api/analytics/campaigns/autumn-intake?from=2026-09-01&to=2026-10-31', headers: bearer('leadership') });
    expect(campaign.json()).toMatchObject({ campaign: 'autumn-intake', lead: 3, applied: 3, enrolled: 3, costPerApplicant: 203_333, channels: ['paid_social'] });
    const list = await app.inject({ method: 'GET', url: '/api/analytics/campaigns?from=2026-09-01&to=2026-10-31', headers: bearer('leadership') });
    expect(list.json().campaigns.find((row: { campaign: string }) => row.campaign === 'open-day')).toMatchObject({ lead: 'fewer_than_3', costPerLead: null });
    expect((await app.inject({ method: 'GET', url: '/api/analytics/channels/billboards?from=2026-09-01&to=2026-10-31', headers: bearer('admin') })).statusCode).toBe(404);
  });

  it('cohorts by month of first touch; cost per hired graduate only for cohorts at least 12 months old', async () => {
    for (let i = 0; i < 3; i += 1) await person('paid_social', '2025-06-10', null, [['lead', '2025-06-10'], ['enrolled', '2025-09-01'], ['hired', '2026-08-01']]);
    for (let i = 0; i < 3; i += 1) await person('paid_social', '2026-05-10', null, [['lead', '2026-05-10'], ['enrolled', '2026-06-01'], ['hired', '2026-11-01']]);
    await app.costs.create({ channel: 'paid_social', description: 'June ads', dateFrom: '2025-06-01', dateTo: '2025-06-30', amount: 300_000, currency: 'AMD' }, 'test');
    await app.costs.create({ channel: 'paid_social', description: 'May ads', dateFrom: '2026-05-01', dateTo: '2026-05-31', amount: 300_000, currency: 'AMD' }, 'test');
    const { db } = await currentTestDatabase();
    const detail = new DetailService({ db, attribution: app.attribution, costs: app.costs, now: () => new Date('2026-11-21T12:00:00Z') });
    const result = await detail.cohorts('first_touch', false, 'paid_social');
    const june = result.cohorts.find((row) => row.month === '2025-06');
    const may = result.cohorts.find((row) => row.month === '2026-05');
    expect(june).toMatchObject({ maturing: false, people: 3, enrolled: 3, hired: 3, costAmd: 300_000, costPerEnrolled: 100_000, costPerHired: 100_000 });
    expect(may).toMatchObject({ maturing: true, hired: 3, costPerEnrolled: 100_000, costPerHired: null });
    expect(result.cohorts[0]?.month).toBe('2026-11');
    expect(result.cohorts).toHaveLength(24);

    const api = await app.inject({ method: 'GET', url: '/api/analytics/cohorts?model=first_touch&channel=paid_social', headers: bearer('viewer') });
    expect(api.statusCode).toBe(200);
    expect(api.json().shared).toBe(true);
  });
});
