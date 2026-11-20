import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactDetailView, ContactView } from '../src/contacts/service.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import { createIntegrations, type Integrations } from '../src/integrations/index.js';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
let integrations: Integrations;

beforeEach(async () => {
  integrations = createIntegrations('mock');
  app = await buildTestApp({ integrations });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const base = { email: 'new.person@example.test', language: 'hy', sourceChannel: 'events' };

const create = (payload: Record<string, unknown>, role = 'editor') =>
  app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer(role), payload });

const patch = (id: string, payload: Record<string, unknown>, role = 'editor') =>
  app.inject({ method: 'PATCH', url: `/api/audience/contacts/${id}`, headers: bearer(role), payload });

const detail = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/audience/contacts/${id}`, headers: bearer('editor') })).json<ContactDetailView>();

const list = (query: string) =>
  app.inject({ method: 'GET', url: `/api/audience/contacts${query}`, headers: bearer('marketing_manager') });

describe('roles on /api/audience/contacts (PRD 4.3)', () => {
  it('needs a staff session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/audience/contacts' })).statusCode).toBe(401);
  });

  it('keeps individual records away from viewers and leadership', async () => {
    for (const role of ['viewer', 'leadership']) {
      expect((await app.inject({ method: 'GET', url: '/api/audience/contacts', headers: bearer(role) })).statusCode).toBe(403);
      expect((await create(base, role)).statusCode).toBe(403);
    }
    for (const role of ['editor', 'marketing_manager', 'admin']) {
      expect((await app.inject({ method: 'GET', url: '/api/audience/contacts', headers: bearer(role) })).statusCode).toBe(200);
    }
  });
});

describe('contact record fields (AUD-02)', () => {
  it('stores every field, normalized', async () => {
    const response = await create({
      email: '  New.Person@Example.TEST ',
      firstName: '  Anna ',
      lastName: 'Hakobyan',
      phone: '+374 (91) 23-45-67',
      language: 'ru',
      type: 'lead',
      sourceChannel: 'paid_social',
      sourceCampaign: 'Spring_Open_Day_2026',
      firstTouchAt: '2026-03-01',
      tags: ['#Python', 'open day', 'python', 'դասընթաց'],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<ContactView>()).toMatchObject({
      email: 'new.person@example.test',
      firstName: 'Anna',
      lastName: 'Hakobyan',
      phone: '+37491234567',
      language: 'ru',
      type: 'lead',
      typeSource: 'marketing_hub',
      corePersonId: null,
      sourceChannel: 'paid_social',
      sourceCampaign: 'spring_open_day_2026',
      firstTouchAt: '2026-02-28T20:00:00.000Z',
      tags: ['python', 'open-day', 'դասընթաց'],
      status: 'active',
    });
  });

  it('defaults to a subscriber whose first touch is now, with name and phone optional', async () => {
    const created = (await create(base)).json<ContactView>();
    expect(created).toMatchObject({ type: 'subscriber', firstName: null, lastName: null, phone: null, tags: [] });
    expect(Date.now() - Date.parse(created.firstTouchAt)).toBeLessThan(60_000);
  });

  it('rejects bad values with the field that needs fixing', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, email: 'not-an-email' }, 'email'],
      [{ ...base, phone: '12' }, 'phone'],
      [{ ...base, tags: ['ok', 'bad tag!'] }, 'tags'],
      [{ ...base, sourceCampaign: 'spring campaign' }, 'sourceCampaign'],
      [{ ...base, firstTouchAt: '2999-01-01' }, 'firstTouchAt'],
      [{ ...base, language: 'de' }, 'language'],
      [{ ...base, sourceChannel: 'tiktok_magic' }, 'sourceChannel'],
      [{ ...base, status: 'unsubscribed' }, ''],
    ];
    for (const [payload, field] of cases) {
      const response = await create(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      if (field) expect(response.json().field).toBe(field);
    }
  });

  it('lists the channel taxonomy from PRD 9.3', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/audience/channels', headers: bearer('editor') });
    expect(response.json().channels).toHaveLength(9);
  });
});

describe('one record per person, linked to the Core Engine (AUD-01)', () => {
  it('links a new contact to the Core Engine person with the same email and mirrors its lifecycle', async () => {
    const created = (await create({ email: 'Ani.Student@example.test', language: 'en', sourceChannel: 'events', type: 'subscriber' })).json<ContactView>();
    expect(created).toMatchObject({
      corePersonId: 'core-p-001',
      type: 'student',
      typeSource: 'core_engine',
      firstName: 'Ani',
      lastName: 'Sample',
      language: 'en',
    });
  });

  it('links to an explicit person ID and rejects an unknown one', async () => {
    const linked = await create({ ...base, corePersonId: 'core-p-002' });
    expect(linked.json()).toMatchObject({ corePersonId: 'core-p-002', type: 'alumnus' });
    const unknown = await create({ ...base, email: 'other@example.test', corePersonId: 'core-p-404' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: 'invalid_field', field: 'corePersonId' });
  });

  it('refuses a second record for the same email or the same person, pointing at the existing one', async () => {
    const first = (await create(base)).json<ContactView>();
    const sameEmail = await create({ ...base, email: ' NEW.PERSON@example.test' });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json()).toMatchObject({ error: 'contact_exists', field: 'email', existingId: first.id });

    const person = (await create({ ...base, email: 'davit@example.test', corePersonId: 'core-p-002' })).json<ContactView>();
    const samePerson = await create({ ...base, email: 'davit.alumnus@example.test' });
    expect(samePerson.statusCode).toBe(409);
    expect(samePerson.json()).toMatchObject({ field: 'corePersonId', existingId: person.id });
  });

  it('creates the contact unlinked when the Core Engine is down, but fails when staff named a person', async () => {
    const coreEngine = integrations.coreEngine as MockCoreEngineClient;
    vi.spyOn(coreEngine, 'findPersonByEmail').mockRejectedValue(new Error('timeout'));
    vi.spyOn(coreEngine, 'getPerson').mockRejectedValue(new Error('timeout'));
    const unlinked = await create({ ...base, email: 'ani.student@example.test' });
    expect(unlinked.statusCode).toBe(201);
    expect(unlinked.json()).toMatchObject({ corePersonId: null, type: 'subscriber' });
    const named = await create({ ...base, email: 'x@example.test', corePersonId: 'core-p-003' });
    expect(named.statusCode).toBe(503);
  });

  it('lets an unlinked contact be linked later, after which the type follows the Core Engine', async () => {
    const created = (await create(base)).json<ContactView>();
    const linked = await patch(created.id, { corePersonId: 'core-p-003' });
    expect(linked.json()).toMatchObject({ corePersonId: 'core-p-003', type: 'applicant', typeSource: 'core_engine' });

    const typeChange = await patch(created.id, { type: 'lead' });
    expect(typeChange.statusCode).toBe(400);
    expect(typeChange.json()).toMatchObject({ field: 'type' });
    expect((await patch(created.id, { corePersonId: 'core-p-001' })).statusCode).toBe(400);
  });
});

describe('editing and audit (PRD 12.4)', () => {
  it('updates fields and records who changed which fields, without the values', async () => {
    const created = (await create(base)).json<ContactView>();
    const updated = await patch(created.id, { firstName: 'Lilit', tags: ['vip'], type: 'lead', phone: null }, 'admin');
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ firstName: 'Lilit', tags: ['vip'], type: 'lead' });

    const { history } = await detail(created.id);
    expect(history.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['contact.created', 'staff-editor'],
      ['contact.updated', 'staff-admin'],
    ]);
    expect(history[1]?.fields.sort()).toEqual(['firstName', 'tags', 'type']);
    expect(JSON.stringify(history)).not.toContain('Lilit');
  });

  it('does not write an audit row when nothing changed', async () => {
    const created = (await create({ ...base, firstName: 'Lilit' })).json<ContactView>();
    expect((await patch(created.id, { firstName: ' Lilit ', language: 'hy' })).statusCode).toBe(200);
    expect((await detail(created.id)).history).toHaveLength(1);
  });

  it('refuses to take an email that belongs to another contact', async () => {
    const first = (await create(base)).json<ContactView>();
    const second = (await create({ ...base, email: 'second@example.test' })).json<ContactView>();
    const response = await patch(second.id, { email: base.email });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ existingId: first.id });
  });

  it('answers 404 for unknown or malformed IDs', async () => {
    expect((await patch('00000000-0000-4000-8000-000000000000', { firstName: 'X' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/audience/contacts/nope', headers: bearer('editor') })).statusCode).toBe(404);
  });
});

describe('contact list (PRD 13.6 Contacts screen)', () => {
  beforeEach(async () => {
    await create({ ...base, email: 'anna@example.test', firstName: 'Anna', lastName: 'Petrosyan', tags: ['python'] });
    await create({ ...base, email: 'aram@example.test', firstName: 'Aram', language: 'en', type: 'lead' });
    await create({ ...base, email: 'mariam_50%@example.test', firstName: 'Mariam' });
  });

  it('searches by email or full name, case-insensitive', async () => {
    const byName = (await list('?q=anna%20petro')).json();
    expect(byName.contacts.map((c: ContactView) => c.email)).toEqual(['anna@example.test']);
    expect((await list('?q=ARAM@')).json().total).toBe(1);
    // "%" is a literal, not a wildcard.
    expect((await list('?q=50%25')).json().total).toBe(1);
  });

  it('filters by type, language and tag, newest first, with paging', async () => {
    expect((await list('?type=lead')).json().total).toBe(1);
    expect((await list('?language=en')).json().contacts[0].email).toBe('aram@example.test');
    expect((await list('?tag=%23Python')).json().total).toBe(1);
    const page = (await list('?limit=2&offset=0')).json();
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(page.contacts).toHaveLength(2);
    expect((await list('?limit=2&offset=2')).json().contacts).toHaveLength(1);
    expect((await list('?limit=500')).statusCode).toBe(400);
  });
});
