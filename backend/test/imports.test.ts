import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { levenshtein, namesLookAlike } from '../src/contacts/duplicates.js';
import { emailKey } from '../src/contacts/fields.js';
import { parseCsv } from '../src/imports/csv.js';
import type { ImportPreview } from '../src/imports/service.js';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const options = { defaultLanguage: 'hy', defaultSourceChannel: 'events' };
const preview = (csv: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/audience/imports/preview', headers: bearer('editor'), payload: { fileName: 'open-day.csv', csv, options, ...extra } });
const commit = (csv: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/audience/imports', headers: bearer('editor'), payload: { fileName: 'open-day.csv', csv, options, ...extra } });
const createContact = (email: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email, language: 'hy', sourceChannel: 'events', ...extra } });

describe('CSV parsing', () => {
  it('handles quotes, commas, line breaks, BOM and semicolons', () => {
    expect(parseCsv('\uFEFFemail,name\r\n"a@x.am","Petrosyan, Anna"\n"b@x.am","Line\nbreak ""quoted"""\n').rows).toEqual([
      ['email', 'name'],
      ['a@x.am', 'Petrosyan, Anna'],
      ['b@x.am', 'Line\nbreak "quoted"'],
    ]);
    expect(parseCsv('Email;Имя\nc@x.am;Мария').rows[1]).toEqual(['c@x.am', 'Мария']);
  });
});

describe('import preview and commit (AUD-03, story AUD-S1)', () => {
  it('shows new contacts, matches and invalid rows before anything is written', async () => {
    for (let i = 0; i < 40; i += 1) await createContact(`known${i}@example.test`);
    const lines = ['Email,First name,Last name,Phone'];
    for (let i = 0; i < 40; i += 1) lines.push(`KNOWN${i}@example.test,Known,${i},`);
    for (let i = 0; i < 460; i += 1) lines.push(`new${i}@example.test,New,Person${i},`);
    lines.push('not-an-email,Bad,Row,', 'new0@example.test,Again,Same,');
    const response = await preview(lines.join('\n'));
    expect(response.statusCode).toBe(200);
    const result = response.json<ImportPreview>();
    expect(result.mapping).toMatchObject({ email: 0, firstName: 1, lastName: 2, phone: 3 });
    expect(result.totals).toMatchObject({ rows: 502, new: 460, match: 40, invalid: 1, duplicate_in_file: 1 });
    expect(result.hasConsentColumn).toBe(false);
    expect(result.problems.find((row) => row.status === 'invalid')).toMatchObject({ line: 502, errors: [expect.stringMatching(/email address/)] });
    expect((await app.contacts.list({ limit: 1, offset: 0 })).total).toBe(40);
  });

  it('imports rows without a consent column as unknown consent, and maps a consent column under the 6.3 rules', async () => {
    const csv = 'email,consent\nyes@example.test,yes\nno@example.test,no\nblank@example.test,\n';
    expect((await commit(csv)).statusCode).toBe(400);
    const result = await commit(csv, { options: { ...options, consentTopic: 'newsletter', tags: ['open-day-2025'] } });
    expect(result.json()).toMatchObject({ created: 3, updated: 0, invalid: 0 });
    const page = await app.contacts.list({ limit: 10, offset: 0 });
    const state = async (email: string) => (await app.consent.current(page.contacts.find((c) => c.email === email)!.id)).newsletter;
    expect(await state('yes@example.test')).toBe('granted');
    expect(await state('no@example.test')).toBe('withdrawn');
    expect(await state('blank@example.test')).toBe('unknown');
    expect(page.contacts[0]).toMatchObject({ tags: ['open-day-2025'], sourceChannel: 'events' });

    const history = (await app.contacts.get(page.contacts[0]!.id))?.history;
    expect(history?.[0]).toMatchObject({ action: 'contact.imported', actorId: 'import:staff-editor' });
  });

  it('updates matches without touching source or first touch, and never overrides an unsubscribe', async () => {
    const known = (await createContact('anna@example.test', { sourceChannel: 'paid_social', tags: ['vip'] })).json();
    await app.consent.unsubscribeAll(known.id, 'link', { kind: 'person' });
    await app.consent.suppress('bounced@example.test', 'hard_bounce', 'esp_webhook');
    const result = await commit('email,first name,consent,source\nanna@example.test,Anna,yes,referrals\nbounced@example.test,Bo,yes,events\n', {
      mapping: { email: 0, firstName: 1, consent: 2, sourceChannel: 3 },
      options: { defaultLanguage: 'en', consentTopic: 'newsletter', tags: ['imported'] },
    });
    expect(result.json()).toMatchObject({ created: 1, updated: 1 });
    const anna = await app.contacts.get(known.id);
    expect(anna).toMatchObject({ firstName: 'Anna', sourceChannel: 'paid_social', status: 'unsubscribed', tags: ['vip', 'imported'] });
    expect((await app.consent.current(known.id)).newsletter).toBe('withdrawn');
    const bounced = (await app.contacts.list({ search: 'bounced', limit: 1, offset: 0 })).contacts[0]!;
    expect(bounced.status).toBe('bounced');
    expect((await app.consent.current(bounced.id)).newsletter).toBe('unknown');
  });

  it('asks for a source when the file has none, and reads dates and languages', async () => {
    const noSource = await app.inject({
      method: 'POST',
      url: '/api/audience/imports/preview',
      headers: bearer('editor'),
      payload: { fileName: 'x.csv', csv: 'email\na@example.test', options: { defaultLanguage: 'hy' } },
    });
    expect(noSource.json()).toMatchObject({ field: 'defaultSourceChannel' });
    await commit('email,language,date,type\nru@example.test,русский,01.03.2026,lead\n', { mapping: { email: 0, language: 1, firstTouchAt: 2, type: 3 } });
    const contact = (await app.contacts.list({ limit: 1, offset: 0 })).contacts[0];
    expect(contact).toMatchObject({ language: 'ru', type: 'lead', firstTouchAt: '2026-02-28T20:00:00.000Z' });
  });

  it('imports 10,000 rows with dedup in under two minutes (NFR-F7)', async () => {
    const lines = ['email,first name,last name'];
    for (let i = 0; i < 10_000; i += 1) lines.push(`bulk${i}@example.test,Bulk,Person ${i}`);
    const started = Date.now();
    const result = await commit(lines.join('\n'));
    expect(result.json()).toMatchObject({ created: 10_000 });
    expect(Date.now() - started).toBeLessThan(120_000);
  }, 130_000);
});

describe('duplicate detection (AUD-04)', () => {
  it('normalizes plus tags and Gmail dots into one key', () => {
    expect(emailKey('A.N.N.A+news@GoogleMail.com')).toBe('anna@gmail.com');
    expect(emailKey('anna+x@academy.am')).toBe('anna@academy.am');
    expect(emailKey('a.nna@academy.am')).toBe('a.nna@academy.am');
  });

  it('matches names with one typo only when the emails look alike too', () => {
    expect(levenshtein('petrosyan', 'petrosian')).toBe(1);
    expect(namesLookAlike({ firstName: 'Anna', lastName: 'Petrosyan', email: 'anna.p@mail.am' }, { firstName: 'Anna', lastName: 'Petrosian', email: 'annap@gmail.com' })).toBe(true);
    expect(namesLookAlike({ firstName: 'Anna', lastName: 'Petrosyan', email: 'anna.p@mail.am' }, { firstName: 'Anna', lastName: 'Petrosyan', email: 'xyz123@gmail.com' })).toBe(false);
  });

  it('suggests pairs by email key, phone and name; dismissed pairs stay hidden', async () => {
    const a = (await createContact('anna.p+news@gmail.com', { firstName: 'Anna', lastName: 'Petrosyan' })).json();
    const b = (await createContact('annap@gmail.com', { firstName: 'Ani', lastName: 'P' })).json();
    const c = (await createContact('lilit@example.test', { phone: '+37491000001' })).json();
    const d = (await createContact('lilit.work@example.test', { phone: '+374 91 000001' })).json();
    const e = (await createContact('davit.sargsyan@mail.am', { firstName: 'Davit', lastName: 'Sargsyan' })).json();
    const f = (await createContact('davitsargsyan@gmail.com', { firstName: 'Davit', lastName: 'Sargsian' })).json();

    const response = await app.inject({ method: 'GET', url: '/api/audience/duplicates', headers: bearer('editor') });
    const pairs = response.json().pairs.map((pair: { reason: string; contacts: { id: string }[] }) => [pair.reason, pair.contacts.map((x) => x.id).sort()]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        ['email_key', [a.id, b.id].sort()],
        ['phone', [c.id, d.id].sort()],
        ['name', [e.id, f.id].sort()],
      ]),
    );

    const forA = await app.inject({ method: 'GET', url: `/api/audience/contacts/${a.id}/duplicates`, headers: bearer('editor') });
    expect(forA.json().duplicates).toEqual([expect.objectContaining({ reason: 'email_key', contact: expect.objectContaining({ id: b.id }) })]);

    await app.inject({ method: 'POST', url: '/api/audience/duplicates/dismiss', headers: bearer('editor'), payload: { contactA: b.id, contactB: a.id } });
    const after = (await app.inject({ method: 'GET', url: '/api/audience/duplicates', headers: bearer('editor') })).json();
    expect(after.pairs).toHaveLength(2);
  });

  it('flags look-alike rows in the import preview', async () => {
    await createContact('anna.p@gmail.com');
    const result = (await preview('email,phone\na.n.n.a.p@gmail.com,\nx@example.test,+37491000002\ny@example.test,+37491000002\n')).json<ImportPreview>();
    expect(result.totals.possibleDuplicates).toBe(2);
    expect(result.problems.map((row) => row.possibleDuplicate?.reason)).toEqual(['email_key', 'phone']);
  });
});

describe('merge (AUD-05)', () => {
  const merge = (keep: string, other: string) =>
    app.inject({ method: 'POST', url: `/api/audience/contacts/${keep}/merge`, headers: bearer('editor'), payload: { otherId: other } });

  it('keeps the earliest first touch with its source, all touchpoints, combined tags and the most restrictive consent', async () => {
    const keep = (await createContact('anna@example.test', { firstName: 'Anna', sourceChannel: 'paid_social', firstTouchAt: '2026-05-01', tags: ['vip'] })).json();
    const other = (await createContact('anna.p+old@example.test', { lastName: 'Petrosyan', phone: '+37491000003', sourceChannel: 'events', sourceCampaign: 'open_day_2025', firstTouchAt: '2025-10-01', tags: ['open-day'] })).json();
    const person = { kind: 'person' } as const;
    await app.consent.record(keep.id, { topics: ['newsletter', 'events'], state: 'granted', method: 'form' }, person);
    await app.consent.record(other.id, { topics: ['newsletter'], state: 'withdrawn', method: 'link' }, person);
    await app.touchpoints.record({ contactId: other.id, channel: 'events', campaign: 'open_day_2025', type: 'attendance', occurredAt: new Date('2025-10-01'), sourceSystem: 'event_hub', sourceRef: 'e1' });

    const response = await merge(keep.id, other.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      email: 'anna@example.test',
      firstName: 'Anna',
      lastName: 'Petrosyan',
      phone: '+37491000003',
      sourceChannel: 'events',
      sourceCampaign: 'open_day_2025',
      firstTouchAt: '2025-09-30T20:00:00.000Z',
      tags: ['vip', 'open-day'],
    });
    const consent = await app.consent.current(keep.id);
    expect(consent).toMatchObject({ newsletter: 'withdrawn', events: 'granted' });
    expect((await app.consent.view(keep.id))?.history.length).toBe(3);
    expect((await app.touchpoints.forContact(keep.id)).map((t) => t.type)).toEqual(['attendance']);
    expect(await app.contacts.get(other.id)).toBeNull();
    expect((await app.contacts.get(keep.id))?.history.at(-1)).toMatchObject({ action: 'contact.merged', actorId: 'staff-editor' });
  });

  it('carries an unsubscribe over to the kept address, and refuses conflicting Core Engine links', async () => {
    const keep = (await createContact('keep@example.test')).json();
    const other = (await createContact('other@example.test')).json();
    await app.consent.unsubscribeAll(other.id, 'link', { kind: 'person' });
    await merge(keep.id, other.id);
    expect((await app.contacts.get(keep.id))?.status).toBe('unsubscribed');

    const a = (await createContact('x@example.test', { corePersonId: 'core-p-001' })).json();
    const b = (await createContact('y@example.test', { corePersonId: 'core-p-002' })).json();
    expect((await merge(a.id, b.id)).statusCode).toBe(409);
    expect((await merge(a.id, a.id)).statusCode).toBe(400);
  });
});
