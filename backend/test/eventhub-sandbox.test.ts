import { describe, expect, it } from 'vitest';
import { contacts, eventHubMessages, events } from '../src/db/schema.js';
import { signWebhook } from '../src/email/webhooks.js';
import { buildTestApp, currentTestDatabase } from './helpers.js';

const SANDBOX = 'event-hub-sandbox-secret-for-development-0123';

describe('Event Hub sandbox and fixtures (EVT-08)', () => {
  it('serves the fixtures and validates signed messages without writing anything', async () => {
    const app = await buildTestApp();
    const fixtures = (await app.inject({ method: 'GET', url: '/api/sandbox/event-hub/fixtures' })).json();
    expect(fixtures).toMatchObject({ contractVersion: '1', signature: { header: 'x-eventhub-signature', toleranceSeconds: 300 } });
    expect(fixtures.messages).toHaveLength(6);
    expect(fixtures.schema.$id).toBe('urn:picsart-academy:marketing-hub:event-hub:v1');

    const post = (message: unknown, secret = SANDBOX) => {
      const body = JSON.stringify(message);
      return app.inject({ method: 'POST', url: '/api/sandbox/event-hub/webhooks', headers: { 'content-type': 'application/json', 'x-eventhub-signature': signWebhook(secret, body) }, payload: body });
    };
    for (const message of fixtures.messages) {
      const response = await post(message);
      expect(response.statusCode, message.type).toBe(200);
      expect(response.json()).toMatchObject({ sandbox: true, status: 'valid', type: message.type, warnings: [] });
    }
    const registration = fixtures.messages.find((message: { type: string }) => message.type === 'registration.created');
    expect((await post(registration)).json()).toMatchObject({ status: 'duplicate' });
    const typo = { ...registration, id: 'typo-1', data: { ...registration.data, consent: [{ topic: 'events', wordingVersion: 'events-v1' }] } };
    expect((await post(typo)).json().warnings[0]).toMatch(/Unknown consent wording events-v1/);
    const invalid = await post({ ...registration, id: 'bad-1', data: { ...registration.data, registeredAt: 'yesterday' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().field).toBe('data.registeredAt');

    // The production secret does not sign sandbox requests, and the sandbox wrote nothing.
    expect((await post(registration, 'development-only-event-hub-secret-0123456789')).statusCode).toBe(401);
    const { db } = await currentTestDatabase();
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(eventHubMessages)).toHaveLength(0);
    await app.close();
  });
});
