import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consentRecords, contacts, outcomes, touchpoints } from '../src/db/schema.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import { createIntegrations } from '../src/integrations/index.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

let app: FastifyInstance;
let coreEngine: MockCoreEngineClient;
beforeEach(async () => {
  const integrations = createIntegrations('mock');
  coreEngine = integrations.coreEngine as MockCoreEngineClient;
  app = await buildTestApp({ integrations });
});
afterEach(() => app.close());

async function anna() {
  const contact = (
    await app.inject({
      method: 'POST',
      url: '/api/audience/contacts',
      headers: bearer('editor'),
      payload: { email: 'anna@example.test', firstName: 'Anna', lastName: 'Petrosyan', phone: '+37491000001', language: 'hy', sourceChannel: 'paid_social', tags: ['python'] },
    })
  ).json();
  await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form', ip: '203.0.113.9', sourceUrl: 'https://academy.example/x' }, { kind: 'person' });
  await app.touchpoints.record({ contactId: contact.id, channel: 'events', campaign: 'open_day', type: 'attendance', occurredAt: new Date('2026-10-01'), sourceSystem: 'event_hub', sourceRef: 'e1' });
  const db = (await currentTestDatabase()).db;
  await db.insert(outcomes).values({ contactId: contact.id, corePersonId: 'core-p-9', type: 'applied', occurredAt: new Date('2026-10-10'), sourceSystem: 'navigator_crm', sourceRef: 'l1' });
  return contact;
}

describe('contact timeline (AUD-16)', () => {
  it('lists consent, touches, outcomes and record changes, newest first', async () => {
    const contact = await anna();
    const response = await app.inject({ method: 'GET', url: `/api/audience/contacts/${contact.id}/timeline`, headers: bearer('editor') });
    const kinds = response.json().items.map((item: { kind: string }) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(['consent', 'touch', 'outcome', 'record']));
    const dates = response.json().items.map((item: { at: string }) => item.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('erasure (AUD-18)', () => {
  it('erases personal data, keeps an anonymous row and the suppression hash', async () => {
    const contact = await anna();
    expect((await app.inject({ method: 'POST', url: `/api/audience/contacts/${contact.id}/erase`, headers: bearer('editor'), payload: { reason: 'x' } })).statusCode).toBe(403);
    const erased = await app.inject({ method: 'POST', url: `/api/audience/contacts/${contact.id}/erase`, headers: bearer('marketing_manager'), payload: { reason: 'Request by email' } });
    expect(erased.statusCode).toBe(204);

    const db = (await currentTestDatabase()).db;
    const [row] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(row).toMatchObject({ email: null, firstName: null, lastName: null, phone: null, tags: [], status: 'erased', language: 'hy', type: 'subscriber', sourceChannel: 'paid_social' });
    const [consent] = await db.select().from(consentRecords).where(eq(consentRecords.contactId, contact.id));
    expect(consent).toMatchObject({ ip: null, sourceUrl: null, state: 'granted' });
    expect((await db.select().from(touchpoints).where(eq(touchpoints.contactId, contact.id)))).toHaveLength(1);
    expect((await db.select().from(outcomes).where(eq(outcomes.contactId, contact.id)))[0]?.corePersonId).toBeNull();
    expect(await app.consent.isSuppressed('anna@example.test')).toBe(true);
    expect(coreEngine.activityLog.at(-1)).toMatchObject({ action: 'contact.erased', reason: 'Request by email' });

    // A new sign-up with the same address starts suppressed: no marketing email by mistake.
    const again = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: 'anna@example.test', language: 'hy', sourceChannel: 'events' } })).json();
    expect(again.status).toBe('erased');
    expect((await app.inject({ method: 'POST', url: `/api/audience/contacts/${contact.id}/erase`, headers: bearer('admin'), payload: { reason: 'again' } })).statusCode).toBe(409);
  });
});

describe('exports (AUD-19, NFR-P4)', () => {
  it('exports a person’s data for an access request and logs it', async () => {
    const contact = await anna();
    const response = await app.inject({ method: 'GET', url: `/api/audience/contacts/${contact.id}/export`, headers: bearer('admin') });
    expect(response.headers['content-disposition']).toMatch(/attachment/);
    expect(response.json()).toMatchObject({ contact: { email: 'anna@example.test', phone: '+37491000001' }, consent: [expect.objectContaining({ ip: '203.0.113.9' })], touchpoints: [expect.objectContaining({ type: 'attendance' })] });
    const log = (await app.inject({ method: 'GET', url: '/api/admin/exports', headers: bearer('marketing_manager') })).json().exports;
    expect(log[0]).toMatchObject({ kind: 'contact_data', contactId: contact.id, actorId: 'staff-admin', rowCount: 1 });
  });

  it('exports a segment as CSV, safe for spreadsheets, and logs user, segment and row count', async () => {
    await anna();
    await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: 'formula@example.test', firstName: '=HYPERLINK("http://evil")', language: 'hy', sourceChannel: 'events' } });
    const segment = (await app.inject({ method: 'POST', url: '/api/audience/segments', headers: bearer('editor'), payload: { name: 'Armenian', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] } } })).json();
    expect((await app.inject({ method: 'GET', url: `/api/audience/segments/${segment.id}/export`, headers: bearer('editor') })).statusCode).toBe(403);
    const response = await app.inject({ method: 'GET', url: `/api/audience/segments/${segment.id}/export`, headers: bearer('marketing_manager') });
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.headers['x-row-count']).toBe('2');
    expect(response.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(response.body.split('\r\n')[0]).toBe('\uFEFFemail,firstName,lastName,phone,language,type,sourceChannel,sourceCampaign,firstTouchAt,tags,status');
    const log = (await app.inject({ method: 'GET', url: '/api/admin/exports', headers: bearer('admin') })).json().exports;
    expect(log[0]).toMatchObject({ kind: 'segment_csv', segmentName: 'Armenian', rowCount: 2, actorId: 'staff-marketing_manager' });
    expect(coreEngine.activityLog.at(-1)).toMatchObject({ action: 'contacts.exported', subjectType: 'segment', metadata: { rows: 2 } });
  });
});
