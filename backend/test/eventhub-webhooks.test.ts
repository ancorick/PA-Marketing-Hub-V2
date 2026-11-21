import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contacts, eventRegistrations, events, manualCosts, touchpoints } from '../src/db/schema.js';
import { signWebhook } from '../src/email/webhooks.js';
import type { EventHubMessage } from '../src/eventhub/contract.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';
import { buildTestApp, currentTestDatabase } from './helpers.js';

const SECRET = 'development-only-event-hub-secret-0123456789';
let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const example = <T extends EventHubMessage['type']>(type: T) => structuredClone(EXAMPLE_MESSAGES.find((message) => message.type === type)!) as Extract<EventHubMessage, { type: T }>;
const send = (message: unknown, secret = SECRET) => {
  const body = JSON.stringify(message);
  return app.inject({ method: 'POST', url: '/api/webhooks/event-hub', headers: { 'content-type': 'application/json', 'x-eventhub-signature': signWebhook(secret, body) }, payload: body });
};

describe('Event Hub webhooks (EVT-02, EVT-03, EVT-04)', () => {
  it('processes the six message types once each', async () => {
    const { db } = await currentTestDatabase();
    expect((await send(example('event.created'))).json()).toEqual({ status: 'processed' });
    const registration = await send(example('registration.created'));
    expect(registration.json()).toEqual({ status: 'processed' });
    expect((await send(example('registration.created'))).json()).toEqual({ status: 'duplicate' });

    // EVT-03: a new contact with the event as source, and the consent the person gave (AUD-07).
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, 'ani.sample@example.test'));
    expect(contact).toMatchObject({ firstName: 'Ani', sourceChannel: 'events', sourceCampaign: 'event-evh-ev-42', language: 'hy' });
    const consent = await app.consent.current(contact!.id);
    expect(consent).toMatchObject({ events: 'granted', newsletter: 'granted', courses: 'unknown' });

    // EVT-04: the registration link's channel just before, then the registration in Events and open days.
    const touches = await db.select().from(touchpoints).where(eq(touchpoints.contactId, contact!.id));
    expect(touches.map((t) => [t.type, t.channel, t.campaign]).sort()).toEqual([
      ['registration', 'events', 'event-evh-ev-42'],
      ['visit', 'paid_social', 'open-day-december'],
    ]);

    expect((await send(example('checkin.recorded'))).json()).toEqual({ status: 'processed' });
    const [row] = await db.select().from(eventRegistrations).where(eq(eventRegistrations.externalId, 'evh-reg-9001'));
    expect(row?.checkedInAt).toBeInstanceOf(Date);
    const attended = await db.select().from(touchpoints).where(eq(touchpoints.type, 'attendance'));
    expect(attended).toHaveLength(1);
    expect(attended[0]).toMatchObject({ channel: 'events', campaign: 'event-evh-ev-42', contactId: contact!.id });

    // The example cancels another registration that Marketing Hub never saw.
    expect((await send(example('registration.cancelled'))).json()).toMatchObject({ status: 'ignored' });
    const cancel = { ...example('registration.cancelled'), id: 'evh-msg-0099', data: { ...example('registration.cancelled').data, registrationId: 'evh-reg-9001' } };
    expect((await send(cancel)).json()).toEqual({ status: 'processed' });
    expect((await db.select().from(eventRegistrations).where(eq(eventRegistrations.externalId, 'evh-reg-9001')))[0]?.status).toBe('cancelled');

    // Costs: Events channel, event as campaign; a resend with the same costId replaces the amount.
    await send(example('event.cost_recorded'));
    const corrected = { ...example('event.cost_recorded'), id: 'evh-msg-0100', data: { ...example('event.cost_recorded').data, amount: 50, currency: 'USD' } };
    await send(corrected);
    const costs = await db.select().from(manualCosts);
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ channel: 'events', campaign: 'event-evh-ev-42', amountAmd: Math.round(50 * 387.5), externalRef: 'event_hub:evh-cost-77' });

    await send(example('event.updated'));
    const [event] = await db.select().from(events).where(eq(events.externalId, 'evh-ev-42'));
    expect(event).toMatchObject({ registrationOpen: false, mediaPublic: true, recordingUrl: 'https://www.youtube.com/watch?v=example' });
  });

  it('links a registration that arrives before its event, and matches known people by email', async () => {
    const { db } = await currentTestDatabase();
    const known = await app.contacts.create({ email: 'Ani.Sample@example.test', language: 'en', sourceChannel: 'search_website' }, { userId: 'test' });
    await send(example('registration.created'));
    const [registration] = await db.select().from(eventRegistrations);
    expect(registration).toMatchObject({ contactId: known.id, eventId: null, eventExternalId: 'evh-ev-42' });
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, known.id));
    expect(contact).toMatchObject({ firstName: 'Ani', sourceChannel: 'search_website', language: 'en' });
    await send(example('event.created'));
    const [linked] = await db.select().from(eventRegistrations);
    const [event] = await db.select().from(events);
    expect(linked?.eventId).toBe(event?.id);
  });

  it('keeps the registration but skips consent with an unknown wording version', async () => {
    const message = example('registration.created');
    message.id = 'evh-msg-0200';
    message.data.consent = [{ topic: 'events', wordingVersion: 'events-hy-v9' }];
    const response = await send(message);
    expect(response.json()).toMatchObject({ status: 'processed', warnings: ['Unknown consent wording events-hy-v9 for events: not recorded'] });
    const { db } = await currentTestDatabase();
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, 'ani.sample@example.test'));
    expect((await app.consent.current(contact!.id)).events).toBe('unknown');
  });

  it('rejects bad signatures and invalid payloads', async () => {
    expect((await send(example('event.created'), 'another-secret-0123456789-0123456789')).statusCode).toBe(401);
    const unsigned = await app.inject({ method: 'POST', url: '/api/webhooks/event-hub', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(example('event.created')) });
    expect(unsigned.statusCode).toBe(401);
    const invalid = await send({ ...example('event.created'), version: '2' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().field).toBe('version');
  });
});
