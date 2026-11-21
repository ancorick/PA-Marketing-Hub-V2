import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contacts, touchpoints } from '../src/db/schema.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

const event = { title: 'Open day (entered by hand)', type: 'open_day', startsAt: '2026-11-07T12:00:00+04:00', language: 'hy', public: true, registrationOpen: false };
const csv = [
  'Email,First name,Last name,Language,Attended,consent_events,consent_newsletter',
  'lilit@example.test,Lilit,Sample,hy,yes,events-hy-v1,newsletter-hy-v1',
  'aram@example.test,Aram,Sample,,no,,',
  'LILIT@example.test,Lilit,Again,hy,yes,,',
  'gor@example.test,Gor,Sample,ru,,events-ru-v1,',
].join('\n');

describe('Event Hub fallback: manual events and attendee CSV (PRD 10.5)', () => {
  it('creates an event by hand and imports attendees with consent, touchpoints and the Events view', async () => {
    const app = await buildTestApp();
    const { db } = await currentTestDatabase();
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: bearer('editor'), payload: event });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    const imported = await app.inject({ method: 'POST', url: `/api/events/${id}/attendees/csv`, headers: bearer('editor'), payload: { csv } });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ rows: 3, newRegistrations: 3, attended: 2, consentRecords: 3 });

    const [lilit] = await db.select().from(contacts).where(eq(contacts.email, 'lilit@example.test'));
    expect(lilit).toMatchObject({ sourceChannel: 'events', sourceCampaign: `event-${id}` });
    expect(await app.consent.current(lilit!.id)).toMatchObject({ events: 'granted', newsletter: 'granted' });
    const touches = await db.select().from(touchpoints).where(eq(touchpoints.contactId, lilit!.id));
    expect(touches.map((t) => t.type).sort()).toEqual(['attendance', 'registration']);

    // Re-importing the same list is idempotent.
    expect((await app.inject({ method: 'POST', url: `/api/events/${id}/attendees/csv`, headers: bearer('editor'), payload: { csv } })).json()).toMatchObject({ newRegistrations: 0 });
    expect(await db.select().from(touchpoints).where(eq(touchpoints.contactId, lilit!.id))).toHaveLength(2);

    await app.costs.create({ channel: 'events', campaign: `event-${id}`, description: 'Catering', dateFrom: '2026-11-07', dateTo: '2026-11-07', amount: 90_000, currency: 'AMD' }, 'test');
    const view = (await app.inject({ method: 'GET', url: '/api/events?from=2026-11-01&to=2026-11-30', headers: bearer('marketing_manager') })).json();
    expect(view.events[0]).toMatchObject({ source: 'manual', registrations: 3, attendees: 2, costAmd: 90_000 });
    await app.close();
  });

  it('rejects a file with bad rows without saving anything, and leaves Event Hub events alone', async () => {
    const app = await buildTestApp();
    const { id } = (await app.inject({ method: 'POST', url: '/api/events', headers: bearer('marketing_manager'), payload: event })).json();
    const bad = await app.inject({
      method: 'POST',
      url: `/api/events/${id}/attendees/csv`,
      headers: bearer('marketing_manager'),
      payload: { csv: 'email,consent_events,attended\nok@example.test,events-hy-v1,yes\nnot-an-email,,\nx@example.test,newsletter-hy-v1,\ny@example.test,,maybe' },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().rows.map((row: { line: number }) => row.line)).toEqual([3, 4, 5]);
    const { db } = await currentTestDatabase();
    expect(await db.select().from(contacts)).toHaveLength(0);

    await app.eventHub.process(EXAMPLE_MESSAGES[0]!);
    const hubEvent = (await app.inject({ method: 'GET', url: '/api/events?from=2026-12-01&to=2026-12-31', headers: bearer('editor') })).json().events[0];
    expect((await app.inject({ method: 'PUT', url: `/api/events/${hubEvent.id}`, headers: bearer('editor'), payload: event })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/events', headers: bearer('leadership'), payload: event })).statusCode).toBe(403);
    await app.close();
  });
});
