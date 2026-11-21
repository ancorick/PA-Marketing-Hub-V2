import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { credit, window, type Touch } from '../src/analytics/attribution.js';
import { outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

const at = (day: string) => new Date(`${day}T10:00:00+04:00`);
const t = (channel: string | null, day: string, campaign: string | null = null): Touch => ({ channel, campaign, at: at(day) });

describe('attribution models (ANL-06, ANL-07)', () => {
  const touches = [t('paid_social', '2026-01-10', 'autumn'), t('events', '2026-02-01'), t('organic_social', '2026-02-15'), t('email', '2026-03-01', 'monthly')];

  it('first touch, last touch and position-based 40/20/40', () => {
    expect(credit(touches, 'first_touch')).toEqual([{ channel: 'paid_social', campaign: 'autumn', share: 1 }]);
    expect(credit(touches, 'last_touch')).toEqual([{ channel: 'email', campaign: 'monthly', share: 1 }]);
    expect(credit(touches, 'position_based').map((c) => [c.channel, c.share])).toEqual([
      ['paid_social', 0.4],
      ['events', 0.1],
      ['organic_social', 0.1],
      ['email', 0.4],
    ]);
    expect(credit(touches.slice(0, 2), 'position_based').map((c) => c.share)).toEqual([0.5, 0.5]);
    expect(credit(touches.slice(0, 1), 'position_based').map((c) => c.share)).toEqual([1]);
  });

  it('no touches = unattributed; a touch without a channel = unmapped; lookback is 365 days before the anchor', () => {
    expect(credit([], 'first_touch')).toEqual([{ channel: 'unattributed', campaign: null, share: 1 }]);
    expect(credit([t(null, '2026-01-01')], 'last_touch')[0]?.channel).toBe('unmapped');
    const inWindow = window([t('email', '2025-03-09'), t('events', '2025-03-11'), t('chatbot', '2026-03-20')], at('2026-03-10'));
    expect(inWindow.map((touch) => touch.channel)).toEqual(['events']);
  });
});

describe('attribution over a period', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp();
  });
  afterEach(() => app.close());

  async function person(email: string, source: 'paid_social' | 'search_website', firstTouch: string) {
    const contact = await app.contacts.create({ email, language: 'hy', sourceChannel: source, firstTouchAt: at(firstTouch) }, { userId: 'test' });
    return contact.id;
  }
  const touch = (contactId: string, channel: string | null, day: string, type: 'click' | 'open' | 'attendance' = 'click', campaign: string | null = null) =>
    app.touchpoints.record({ contactId, channel, campaign, type, occurredAt: at(day), sourceSystem: 'test', sourceRef: null });
  const outcome = async (contactId: string | null, type: string, day: string, ref: string) => {
    const { db } = await currentTestDatabase();
    await db.insert(outcomes).values({ contactId, corePersonId: contactId ? null : ref, type, occurredAt: at(day), sourceSystem: 'test', sourceRef: ref });
  };

  it('credits each outcome in the period by model; the application date anchors last touch', async () => {
    const ani = await person('ani@example.test', 'paid_social', '2026-01-10');
    await touch(ani, 'events', '2026-02-01', 'attendance');
    await touch(ani, 'email', '2026-03-01', 'click', 'monthly');
    await touch(ani, 'email', '2026-03-05', 'open'); // estimated opens never count
    await touch(ani, 'organic_social', '2026-03-20'); // after the application
    await outcome(ani, 'lead', '2026-01-10', 'l-ani');
    await outcome(ani, 'applied', '2026-03-10', 'a-ani');
    await outcome(ani, 'enrolled', '2026-04-01', 'e-ani');
    const gor = await person('gor@example.test', 'search_website', '2026-03-01');
    await touch(gor, null, '2026-03-02');
    await outcome(gor, 'lead', '2026-03-03', 'l-gor');
    await outcome(null, 'enrolled', '2026-04-02', 'core-p-unlinked');

    const range = { from: '2026-01-01', to: '2026-06-30' };
    const first = await app.attribution.byChannel(range, 'first_touch');
    expect(first.find((row) => row.channel === 'paid_social')).toMatchObject({ lead: 1, applied: 1, enrolled: 1 });
    expect(first.find((row) => row.channel === 'search_website')).toMatchObject({ lead: 1 });
    expect(first.find((row) => row.channel === 'unattributed')).toMatchObject({ enrolled: 1 });

    const last = await app.attribution.byChannel(range, 'last_touch');
    expect(last.find((row) => row.channel === 'email')).toMatchObject({ applied: 1, enrolled: 1 });
    expect(last.find((row) => row.channel === 'unmapped')).toMatchObject({ lead: 1 });
    expect(last.find((row) => row.channel === 'organic_social')).toBeUndefined();

    const position = await app.attribution.byChannel(range, 'position_based');
    expect(position.find((row) => row.channel === 'events')?.enrolled).toBe(0.2);
    const enrolled = position.reduce((sum, row) => sum + row.enrolled, 0);
    expect(enrolled).toBeCloseTo(2);

    const campaigns = await app.attribution.byCampaign(range, 'last_touch', 'email');
    expect(campaigns).toEqual([expect.objectContaining({ key: 'monthly', applied: 1, enrolled: 1 })]);

    const response = await app.inject({ method: 'GET', url: '/api/analytics/attribution?from=2026-04-01&to=2026-04-30&model=last_touch', headers: bearer('marketing_manager') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ model: 'last_touch', modelLabel: 'Last touch (before application)', lookbackDays: 365 });
    expect(response.json().rows.map((row: { channel: string; enrolled: number }) => [row.channel, row.enrolled]).sort()).toEqual([
      ['email', 1],
      ['unattributed', 1],
    ]);

    const contact = await app.inject({ method: 'GET', url: `/api/analytics/attribution/contacts/${ani}`, headers: bearer('editor') });
    expect(contact.json().models.first_touch[0].channel).toBe('paid_social');
    expect((await app.inject({ method: 'GET', url: `/api/analytics/attribution/contacts/${ani}`, headers: bearer('leadership') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/analytics/attribution?from=2026-04-01&to=2026-04-30&model=linear', headers: bearer('admin') })).statusCode).toBe(400);
  });
});
