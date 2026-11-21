import { describe, expect, it } from 'vitest';
import { exportLog } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase, testConfig } from './helpers.js';

const KEY = 'event-hub-api-key-for-tests-0123456789abcdef';
const key = { 'x-api-key': KEY };

describe('Marketing Hub → Event Hub (EVT-07)', () => {
  it('shares only segments a manager marked, with invitees who have events consent and are not suppressed', async () => {
    const app = await buildTestApp({ config: testConfig({ EVENT_HUB_API_KEY: KEY }) });
    const person = async (email: string, events: boolean) => {
      const contact = await app.contacts.create({ email, language: 'hy', sourceChannel: 'events' }, { userId: 'test' });
      if (events) await app.consent.record(contact.id, { topics: ['events'], state: 'granted', method: 'form', wordingVersion: 'events-hy-v1' }, { kind: 'person' });
      return contact.id;
    };
    const ids = [await person('yes@example.test', true), await person('no-consent@example.test', false), await person('gone@example.test', true)];
    await app.consent.suppress('gone@example.test', 'unsubscribed', 'test');
    const segment = await app.segments.create({ name: 'Alumni meetup invitees', type: 'static' }, 'mock-marketing_manager');
    await app.segments.addMembers(segment.id, { contactIds: ids }, 'mock-marketing_manager');

    expect((await app.inject({ method: 'GET', url: '/api/integrations/event-hub/segments', headers: key })).json()).toEqual({ segments: [] });
    expect((await app.inject({ method: 'GET', url: `/api/integrations/event-hub/segments/${segment.id}/invitees`, headers: key })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/audience/segments/${segment.id}/event-hub`, headers: bearer('editor'), payload: { shared: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/audience/segments/${segment.id}/event-hub`, headers: bearer('marketing_manager'), payload: { shared: true } })).json()).toMatchObject({ sharedWithEventHub: true });

    expect((await app.inject({ method: 'GET', url: '/api/integrations/event-hub/segments', headers: key })).json().segments).toEqual([expect.objectContaining({ id: segment.id, name: 'Alumni meetup invitees' })]);
    const invitees = await app.inject({ method: 'GET', url: `/api/integrations/event-hub/segments/${segment.id}/invitees`, headers: key });
    expect(invitees.json()).toMatchObject({ purpose: 'event_invitation', consentTopic: 'events', invitees: [{ email: 'yes@example.test', language: 'hy' }] });
    const { db } = await currentTestDatabase();
    expect(await db.select().from(exportLog)).toEqual([expect.objectContaining({ actorId: 'event_hub', kind: 'event_hub_invitees', segmentId: segment.id, rowCount: 1 })]);
    await app.close();
  });

  it('checks suppression for any list and serves the consent wordings; needs the service key', async () => {
    const app = await buildTestApp({ config: testConfig({ EVENT_HUB_API_KEY: KEY }) });
    await app.consent.suppress('Bounced@Example.test', 'hard_bounce', 'test');
    const check = await app.inject({ method: 'POST', url: '/api/integrations/event-hub/suppression-check', headers: key, payload: { emails: ['bounced@example.test', 'fine@example.test'] } });
    expect(check.json()).toEqual({ suppressed: ['bounced@example.test'] });
    const wordings = (await app.inject({ method: 'GET', url: '/api/integrations/event-hub/consent-wordings', headers: key })).json().wordings;
    expect(wordings).toEqual(expect.arrayContaining([expect.objectContaining({ version: 'events-hy-v1', topic: 'events' })]));
    expect((await app.inject({ method: 'GET', url: '/api/integrations/event-hub/segments', headers: bearer('admin') })).statusCode).toBe(401);
    await app.close();
    const off = await buildTestApp();
    expect((await off.inject({ method: 'GET', url: '/api/integrations/event-hub/segments', headers: key })).statusCode).toBe(503);
    await off.close();
  });
});
