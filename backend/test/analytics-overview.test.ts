import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { previousPeriod } from '../src/analytics/overview.js';
import { outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

const at = (day: string) => new Date(`${day}T10:00:00+04:00`);
let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

let seq = 0;
/** One person from a channel with a lead and, optionally, an enrollment. */
async function person(channel: 'paid_social' | 'events', options: { enrolled?: boolean; subscribed?: boolean; leadDay?: string } = {}) {
  seq += 1;
  const day = options.leadDay ?? '2026-10-05';
  const contact = await app.contacts.create({ email: `p${seq}@example.test`, language: 'hy', sourceChannel: channel, firstTouchAt: at(day) }, { userId: 'test' });
  const { db } = await currentTestDatabase();
  await db.insert(outcomes).values({ contactId: contact.id, type: 'lead', occurredAt: at(day), sourceSystem: 'test', sourceRef: `l${seq}` });
  if (options.enrolled) await db.insert(outcomes).values({ contactId: contact.id, type: 'enrolled', occurredAt: at('2026-10-20'), sourceSystem: 'test', sourceRef: `e${seq}` });
  if (options.subscribed)
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form', wordingVersion: 'newsletter-hy-v1' }, { kind: 'person' });
  return contact.id;
}

const get = (role: string, query = 'from=2026-10-01&to=2026-10-31&model=first_touch') => app.inject({ method: 'GET', url: `/api/analytics/overview?${query}`, headers: bearer(role) });

describe('Overview (ANL-08, ANL-14, ANL-15)', () => {
  it('shows tiles and the channel table with cost per enrolled student for marketing roles', async () => {
    for (let i = 0; i < 4; i += 1) await person('paid_social', { enrolled: true, subscribed: i < 3 });
    await person('paid_social');
    await person('events', { enrolled: true });
    await person('paid_social', { leadDay: '2026-09-10' }); // previous period
    await app.costs.create({ channel: 'paid_social', description: 'Agency fee', dateFrom: '2026-10-01', dateTo: '2026-10-31', amount: 400_000, currency: 'AMD' }, 'test');

    const response = await get('marketing_manager');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ model: 'first_touch', modelLabel: 'First touch', shared: false, previous: { from: '2026-08-31', to: '2026-09-30' } });
    expect(body.tiles).toMatchObject({ subscribers: 3, newLeads: { value: 6, previous: 1 }, enrolledFromLeads: { value: 5, previous: 0 } });
    expect(body.channels.find((row: { channel: string }) => row.channel === 'paid_social')).toMatchObject({ lead: 5, enrolled: 4, costAmd: 400_000, costPerEnrolled: 100_000, costPerLead: 80_000 });
    expect(body.channels.find((row: { channel: string }) => row.channel === 'events')).toMatchObject({ lead: 1, enrolled: 1, costAmd: 0 });
    expect(body.channels.map((row: { channel: string }) => row.channel)).toEqual(expect.arrayContaining(['unmapped', 'unattributed']));
    expect(body.totals).toMatchObject({ lead: 6, enrolled: 5, costAmd: 400_000, costPerEnrolled: 80_000 });
    expect(body.definitions.costPerEnrolled).toMatch(/divided by the enrolled students/);
  });

  it('hides counts of 1 or 2 people, and costs per person over them, outside marketing', async () => {
    await person('events', { enrolled: true });
    for (let i = 0; i < 3; i += 1) await person('paid_social');
    await app.costs.create({ channel: 'events', description: 'Catering', dateFrom: '2026-10-10', dateTo: '2026-10-10', amount: 90_000, currency: 'AMD' }, 'test');
    for (const role of ['leadership', 'viewer']) {
      const body = (await get(role)).json();
      expect(body.shared).toBe(true);
      expect(body.channels.find((row: { channel: string }) => row.channel === 'events')).toMatchObject({ lead: 'fewer_than_3', enrolled: 'fewer_than_3', costAmd: 90_000, costPerEnrolled: null });
      expect(body.channels.find((row: { channel: string }) => row.channel === 'paid_social')).toMatchObject({ lead: 3, enrolled: 0 });
      expect(body.tiles.enrolledFromLeads.value).toBe('fewer_than_3');
    }
    const attribution = await app.inject({ method: 'GET', url: '/api/analytics/attribution?from=2026-10-01&to=2026-10-31', headers: bearer('leadership') });
    expect(attribution.json().rows.find((row: { channel: string }) => row.channel === 'events').enrolled).toBe('fewer_than_3');
  });

  it('lists the contacts behind a number for marketing roles only', async () => {
    const ids = [await person('paid_social', { enrolled: true }), await person('paid_social', { enrolled: true }), await person('events', { enrolled: true })];
    const people = await app.inject({ method: 'GET', url: '/api/analytics/people?from=2026-10-01&to=2026-10-31&model=first_touch&stage=enrolled&channel=paid_social', headers: bearer('editor') });
    expect(people.statusCode).toBe(200);
    expect(people.json()).toMatchObject({ total: 2, stage: 'enrolled', channel: 'paid_social', modelLabel: 'First touch' });
    expect(people.json().people.map((p: { id: string }) => p.id).sort()).toEqual(ids.slice(0, 2).sort());
    expect((await app.inject({ method: 'GET', url: '/api/analytics/people?from=2026-10-01&to=2026-10-31&stage=enrolled&channel=paid_social', headers: bearer('leadership') })).statusCode).toBe(403);
  });

  it('accepts any range up to 24 months', async () => {
    expect((await get('admin', 'from=2024-11-01&to=2026-10-31')).statusCode).toBe(200);
    expect((await get('admin', 'from=2023-01-01&to=2026-10-31')).statusCode).toBe(400);
    expect(previousPeriod({ from: '2026-07-01', to: '2026-09-30' })).toEqual({ from: '2026-03-31', to: '2026-06-30' });
  });
});
