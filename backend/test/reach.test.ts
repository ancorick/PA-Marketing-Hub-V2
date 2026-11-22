import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportLog, outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

/* RESTRUCTURE R4, group REACH: data added for Contacts, Audience health and Events. */

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const at = (day: string) => new Date(`${day}T10:00:00+04:00`);
let seq = 0;
async function contact(options: { phone?: string; consent?: 'granted' | 'withdrawn'; language?: 'hy' | 'en' | 'ru'; type?: 'subscriber' | 'lead' } = {}) {
  seq += 1;
  const created = await app.contacts.create(
    { email: `r${seq}@example.test`, firstName: 'Reach', lastName: `Person${seq}`, language: options.language ?? 'hy', sourceChannel: 'organic_social', phone: options.phone, type: options.type },
    { userId: 'test' },
  );
  if (options.consent)
    await app.consent.record(created.id, { topics: ['newsletter'], state: options.consent, method: 'manual', reason: 'test', wordingVersion: 'newsletter-hy-v1' }, { kind: 'staff', userId: 'test' });
  return created;
}

describe('Contacts list for REACH', () => {
  it('searches phone numbers, filters by status and shows the newsletter consent of each row', async () => {
    const withPhone = await contact({ phone: '+37491234567', consent: 'granted' });
    await contact({ consent: 'withdrawn' });
    const left = await contact();
    await app.consent.unsubscribeAll(left.id, 'manual', { kind: 'staff', userId: 'test' }, { reason: 'test' });

    const list = (url: string) => app.inject({ method: 'GET', url, headers: bearer('editor') }).then((response) => response.json());
    const byPhone = await list('/api/audience/contacts?q=91%20234');
    expect(byPhone.contacts.map((row: { id: string }) => row.id)).toEqual([withPhone.id]);
    expect(byPhone.contacts[0].newsletterConsent).toBe('granted');

    const all = await list('/api/audience/contacts');
    const states = Object.fromEntries(all.contacts.map((row: { id: string; newsletterConsent: string }) => [row.id, row.newsletterConsent]));
    expect(states[withPhone.id]).toBe('granted');
    expect(Object.values(states)).toContain('withdrawn');

    const unsubscribed = await list('/api/audience/contacts?status=unsubscribed');
    expect(unsubscribed.contacts.map((row: { id: string }) => row.id)).toEqual([left.id]);
    expect((await app.inject({ method: 'GET', url: '/api/audience/contacts?status=gone', headers: bearer('editor') })).statusCode).toBe(400);
  });

  it('counts the metric strip: everyone, with consent, unsubscribed and suppressed', async () => {
    await contact({ consent: 'granted' });
    await contact({ consent: 'granted' });
    await contact({ consent: 'granted' });
    const left = await contact({ consent: 'granted' });
    await app.consent.unsubscribeAll(left.id, 'manual', { kind: 'staff', userId: 'test' }, { reason: 'test' });
    const summary = (await app.inject({ method: 'GET', url: '/api/audience/summary', headers: bearer('marketing_manager') })).json();
    expect(summary).toEqual({ total: 4, withConsent: 3, unsubscribed: 1, suppressed: 1 });
    // Outside marketing, one or two people are not shown.
    expect((await app.inject({ method: 'GET', url: '/api/audience/summary', headers: bearer('leadership') })).json()).toMatchObject({ unsubscribed: 'fewer_than_3', withConsent: 3 });
  });
});

describe('Audience health', () => {
  it('reports consent coverage, type and language mix, growth and people leaving the list', async () => {
    await contact({ consent: 'granted', language: 'en' });
    await contact({ consent: 'granted', type: 'lead' });
    await contact({ consent: 'withdrawn' });
    const bounced = await contact();
    await app.consent.suppress(bounced.email!, 'hard_bounce', 'esp_webhook');

    const health = (await app.inject({ method: 'GET', url: '/api/audience/health', headers: bearer('admin') })).json();
    expect(health.total).toBe(4);
    expect(health.consent).toEqual({ granted: 2, withdrawn: 1, pending: 0, unknown: 1 });
    expect(health.consentRecordedRate).toBeCloseTo(0.75);
    expect(health.byLanguage).toEqual(expect.arrayContaining([{ key: 'hy', count: 3 }, { key: 'en', count: 1 }]));
    expect(health.newPerMonth).toHaveLength(18);
    expect(health.newPerMonth.at(-1).count).toBe(4);
    expect(health.leavingPerMonth).toHaveLength(12);
    expect(health.leavingPerMonth.at(-1)).toMatchObject({ bounced: 1, unsubscribed: 0, complaints: 0 });
    expect(Array.isArray(health.largestSegments)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/audience/health', headers: bearer('viewer') })).statusCode).toBe(200);
  });
});

describe('Events as a channel', () => {
  const event = { title: 'Open day: November', type: 'open_day', startsAt: '2026-11-07T12:00:00+04:00', language: 'hy', public: true, recordingUrl: 'https://video.example.test/open-day' };
  const csv = ['email,first_name,last_name,attended', 'ani@example.test,Ani,Sample,yes', 'aram@example.test,Aram,Sample,no', 'gor@example.test,Gor,Sample,yes'].join('\n');

  it('credits outcomes to the event under the chosen model, with media and cost per enrolled', async () => {
    const { id } = (await app.inject({ method: 'POST', url: '/api/events', headers: bearer('editor'), payload: event })).json();
    await app.inject({ method: 'POST', url: `/api/events/${id}/attendees/csv`, headers: bearer('editor'), payload: { csv } });
    await app.costs.create({ channel: 'events', campaign: `event-${id}`, description: 'Venue', dateFrom: '2026-11-07', dateTo: '2026-11-07', amount: 300_000, currency: 'AMD' }, 'test');
    const { db } = await currentTestDatabase();
    const people = await app.inject({ method: 'GET', url: '/api/audience/contacts?q=example.test', headers: bearer('editor') }).then((r) => r.json().contacts as { id: string; email: string }[]);
    for (const person of people) {
      await db.insert(outcomes).values({ contactId: person.id, type: 'lead', occurredAt: at('2026-11-10'), sourceSystem: 'test', sourceRef: `l-${person.email}` });
      if (person.email !== 'aram@example.test') await db.insert(outcomes).values({ contactId: person.id, type: 'enrolled', occurredAt: at('2026-11-20'), sourceSystem: 'test', sourceRef: `e-${person.email}` });
    }

    const plain = (await app.inject({ method: 'GET', url: '/api/events?from=2026-11-01&to=2026-11-30', headers: bearer('marketing_manager') })).json();
    expect(plain.events[0]).toMatchObject({ credited: null, recordingUrl: 'https://video.example.test/open-day', registrations: 3, attendees: 2 });
    const credited = (await app.inject({ method: 'GET', url: '/api/events?from=2026-11-01&to=2026-11-30&model=first_touch', headers: bearer('marketing_manager') })).json();
    expect(credited).toMatchObject({ model: 'first_touch', modelLabel: 'First touch' });
    expect(credited.events[0]).toMatchObject({ credited: { lead: 3, enrolled: 2, hired: 0 }, costPerEnrolled: 150_000 });
    expect(credited.totals.credited).toEqual({ lead: 3, enrolled: 2, hired: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/events?from=2026-11-01&to=2026-11-30&model=best', headers: bearer('viewer') })).statusCode).toBe(400);
  });

  it('downloads the attendee list for the marketing team and logs the export', async () => {
    const { id } = (await app.inject({ method: 'POST', url: '/api/events', headers: bearer('editor'), payload: event })).json();
    await app.inject({ method: 'POST', url: `/api/events/${id}/attendees/csv`, headers: bearer('editor'), payload: { csv } });
    expect((await app.inject({ method: 'GET', url: `/api/events/${id}/attendees.csv`, headers: bearer('leadership') })).statusCode).toBe(403);
    const file = await app.inject({ method: 'GET', url: `/api/events/${id}/attendees.csv`, headers: bearer('editor') });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toContain('attendees-open-day-november.csv');
    const lines = file.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('first_name,last_name,email,language,registration,registered_at,attended,checked_in_at,source');
    expect(lines).toHaveLength(4);
    expect(lines.filter((line) => line.includes(',yes,'))).toHaveLength(2);
    const { db } = await currentTestDatabase();
    expect(await db.select().from(exportLog).where(eq(exportLog.kind, 'event_attendees'))).toEqual([expect.objectContaining({ actorId: expect.any(String), rowCount: 3, segmentName: 'Open day: November' })]);
    expect((await app.inject({ method: 'GET', url: '/api/events/00000000-0000-4000-8000-000000000000/attendees.csv', headers: bearer('editor') })).statusCode).toBe(404);
  });
});
