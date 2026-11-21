import { describe, expect, it } from 'vitest';
import { outcomes } from '../src/db/schema.js';
import { buildTestApp, currentTestDatabase, testConfig } from './helpers.js';

const KEY = 'command-center-test-key-0123456789abcdef';
const url = '/api/v1/command-center/metrics?from=2026-10-01&to=2026-10-31&model=last_touch';

describe('Command Center metrics API (ANL-13)', () => {
  it('answers 503 until a key is configured, 401 for a wrong key', async () => {
    const off = await buildTestApp();
    expect((await off.inject({ method: 'GET', url, headers: { 'x-api-key': KEY } })).statusCode).toBe(503);
    await off.close();
    const app = await buildTestApp({ config: testConfig({ COMMAND_CENTER_API_KEY: KEY }) });
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { 'x-api-key': `${KEY}x` } })).statusCode).toBe(401);
    // Staff tokens do not open it: it is a service key, not a sign-in.
    expect((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer mock-admin' } })).statusCode).toBe(401);
    await app.close();
  });

  it('returns the Overview aggregates with small numbers hidden and no personal data', async () => {
    const app = await buildTestApp({ config: testConfig({ COMMAND_CENTER_API_KEY: KEY }) });
    const contact = await app.contacts.create({ email: 'secret.person@example.test', language: 'hy', sourceChannel: 'events', firstTouchAt: new Date('2026-10-02T10:00:00+04:00') }, { userId: 'test' });
    const { db } = await currentTestDatabase();
    await db.insert(outcomes).values({ contactId: contact.id, type: 'lead', occurredAt: new Date('2026-10-02T10:00:00+04:00'), sourceSystem: 'test', sourceRef: 'l1' });
    const response = await app.inject({ method: 'GET', url, headers: { 'x-api-key': KEY } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ contractVersion: 'v1', model: 'last_touch', modelLabel: 'Last touch (before application)', currency: 'AMD', lookbackDays: 365 });
    expect(body.channels.find((row: { channel: string }) => row.channel === 'events').lead).toBe('fewer_than_3');
    expect(body.tiles.newLeads.value).toBe('fewer_than_3');
    expect(body.cohorts).toHaveLength(24);
    expect(response.body).not.toContain('secret.person');
    expect(response.body).not.toContain(contact.id);
    expect((await app.inject({ method: 'GET', url: '/api/v1/command-center/metrics?from=2026-10-31&to=2026-10-01', headers: { 'x-api-key': KEY } })).statusCode).toBe(400);
    await app.close();
  });
});
