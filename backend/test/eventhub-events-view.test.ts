import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contacts, outcomes } from '../src/db/schema.js';
import type { EventHubMessage } from '../src/eventhub/contract.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

const example = <T extends EventHubMessage['type']>(type: T) => structuredClone(EXAMPLE_MESSAGES.find((message) => message.type === type)!) as Extract<EventHubMessage, { type: T }>;

describe('Events view (EVT-05)', () => {
  it('shows each event with cost, registrations, attendees and outcomes after registering', async () => {
    const app = await buildTestApp();
    const { db } = await currentTestDatabase();
    await app.eventHub.process(example('event.created'));
    for (let i = 1; i <= 4; i += 1) {
      const registration = example('registration.created');
      registration.id = `reg-msg-${i}`;
      registration.data.registrationId = `reg-${i}`;
      registration.data.contact.email = `guest${i}@example.test`;
      await app.eventHub.process(registration);
      if (i <= 3) await app.eventHub.process({ ...example('checkin.recorded'), id: `chk-${i}`, data: { ...example('checkin.recorded').data, registrationId: `reg-${i}` } });
    }
    await app.eventHub.process({ ...example('registration.cancelled'), data: { ...example('registration.cancelled').data, registrationId: 'reg-4' } });
    await app.eventHub.process(example('event.cost_recorded'));
    for (let i = 1; i <= 3; i += 1) {
      const [contact] = await db.select().from(contacts).where(eq(contacts.email, `guest${i}@example.test`));
      await db.insert(outcomes).values({ contactId: contact!.id, type: 'lead', occurredAt: new Date('2026-12-06T10:00:00+04:00'), sourceSystem: 'test', sourceRef: `l${i}` });
      if (i === 1) await db.insert(outcomes).values({ contactId: contact!.id, type: 'enrolled', occurredAt: new Date('2027-01-15T10:00:00+04:00'), sourceSystem: 'test', sourceRef: `e${i}` });
    }
    // An outcome before registering does not count for the event.
    const [early] = await db.select().from(contacts).where(eq(contacts.email, 'guest2@example.test'));
    await db.insert(outcomes).values({ contactId: early!.id, type: 'hired', occurredAt: new Date('2026-01-01T10:00:00+04:00'), sourceSystem: 'test', sourceRef: 'h2' });

    const response = await app.inject({ method: 'GET', url: '/api/events?from=2026-12-01&to=2026-12-31', headers: bearer('marketing_manager') });
    expect(response.statusCode).toBe(200);
    const [row] = response.json().events;
    expect(row).toMatchObject({ title: 'Open day: Frontend and Data courses', source: 'event_hub', campaign: 'event-evh-ev-42', costAmd: 180000, registrations: 3, attendees: 3, leads: 3, enrolled: 1, hired: 0, costPerAttendee: 60000 });

    const shared = (await app.inject({ method: 'GET', url: '/api/events?from=2026-12-01&to=2026-12-31', headers: bearer('leadership') })).json();
    expect(shared.events[0]).toMatchObject({ registrations: 3, enrolled: 'fewer_than_3', costAmd: 180000 });
    expect((await app.inject({ method: 'GET', url: '/api/events?from=2027-01-01&to=2027-01-31', headers: bearer('viewer') })).json().events).toEqual([]);
    await app.close();
  });
});
