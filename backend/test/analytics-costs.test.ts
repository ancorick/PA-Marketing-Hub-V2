import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocated } from '../src/analytics/costs.js';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const agency = { channel: 'paid_social', campaign: 'Autumn Intake', description: 'Agency fee, October', dateFrom: '2026-10-01', dateTo: '2026-10-31', amount: 1000, currency: 'usd' };
const post = (payload: Record<string, unknown>, role = 'marketing_manager') => app.inject({ method: 'POST', url: '/api/analytics/costs', headers: bearer(role), payload });

describe('manual costs (ANL-05)', () => {
  it('stores AMD at the CBA rate with the original amount and currency', async () => {
    const response = await post(agency);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ channel: 'paid_social', campaign: 'autumn-intake', amountAmd: 387_500, originalAmount: '1000.00', currency: 'USD', rateToAmd: 387.5 });
  });

  it('allocates a cost to the days of a period and adds ad spend per channel', async () => {
    await post(agency);
    await post({ channel: 'events', description: 'Open day catering', dateFrom: '2026-10-20', dateTo: '2026-10-20', amount: 150_000, currency: 'AMD' });
    await app.pipeline.pull('meta_ads', { from: '2026-10-01', to: '2026-10-15' });
    const response = await app.inject({ method: 'GET', url: '/api/analytics/costs?from=2026-10-01&to=2026-10-15', headers: bearer('leadership') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.costs).toHaveLength(1);
    const paidSocial = body.channels.find((row: { channel: string }) => row.channel === 'paid_social');
    expect(paidSocial.manualAmd).toBe(Math.round((387_500 * 15) / 31));
    expect(paidSocial.adSpendAmd).toBeGreaterThan(0);
    expect(paidSocial.totalAmd).toBe(paidSocial.adSpendAmd + paidSocial.manualAmd);
    expect(body.channels.find((row: { channel: string }) => row.channel === 'events').totalAmd).toBe(0);
    expect(allocated({ dateFrom: '2026-10-01', dateTo: '2026-10-31', amountAmd: 310 }, { from: '2026-11-01', to: '2026-11-30' })).toBe(0);
  });

  it('validates the entry and names the field', async () => {
    expect((await post({ ...agency, amount: 0 })).json()).toMatchObject({ field: 'amount' });
    expect((await post({ ...agency, dateTo: '2026-09-30' })).json()).toMatchObject({ field: 'dateTo' });
    expect((await post({ ...agency, currency: 'XYZ' })).json()).toMatchObject({ field: 'currency' });
    expect((await post({ ...agency, channel: 'billboards' })).json()).toMatchObject({ field: 'channel' });
    expect((await post({ ...agency, description: ' ' })).json()).toMatchObject({ field: 'description' });
  });

  it('managers and admins edit and delete; editors and leadership only read', async () => {
    expect((await post(agency, 'editor')).statusCode).toBe(403);
    expect((await post(agency, 'leadership')).statusCode).toBe(403);
    const { id } = (await post(agency)).json();
    const updated = await app.inject({ method: 'PUT', url: `/api/analytics/costs/${id}`, headers: bearer('admin'), payload: { ...agency, amount: 500, currency: 'EUR' } });
    expect(updated.json()).toMatchObject({ amountAmd: Math.round(500 * 452.1), updatedBy: expect.stringContaining('admin') });
    expect((await app.inject({ method: 'DELETE', url: `/api/analytics/costs/${id}`, headers: bearer('editor') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/analytics/costs/${id}`, headers: bearer('marketing_manager') })).statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/analytics/costs?from=2026-10-01&to=2026-10-31', headers: bearer('editor') });
    expect(list.json().costs).toEqual([]);
  });
});
