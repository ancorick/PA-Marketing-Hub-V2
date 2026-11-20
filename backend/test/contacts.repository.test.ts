import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleContactRepository, DuplicateContactError, type NewContact } from '../src/contacts/repository.js';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

// The real SQL migrations on an in-process Postgres (PGlite), then the Drizzle repository on top.
const client = new PGlite();
const db = drizzle({ client, schema });
const repository = new DrizzleContactRepository(db);

const contact = (overrides: Partial<NewContact> = {}): NewContact => ({
  corePersonId: null,
  email: 'anna@example.test',
  phone: null,
  firstName: 'Anna',
  lastName: 'Petrosyan',
  language: 'hy',
  type: 'subscriber',
  sourceChannel: 'events',
  sourceCampaign: null,
  firstTouchAt: new Date('2026-03-01T08:00:00Z'),
  tags: ['python', 'open-day'],
  ...overrides,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
});

afterAll(async () => {
  await client.close();
});

describe('DrizzleContactRepository on the migrated schema (AUD-01, AUD-02)', () => {
  it('stores a contact with tags, defaults and an audit row in one transaction', async () => {
    const created = await repository.insert(contact(), 'staff-editor');
    expect(created).toMatchObject({ email: 'anna@example.test', tags: ['python', 'open-day'], status: 'active' });
    expect(await repository.findByEmail('anna@example.test')).toEqual(created);

    const updated = await repository.update(created.id, { firstName: 'Ani', tags: [] }, 'staff-admin');
    expect(updated).toMatchObject({ firstName: 'Ani', tags: [] });
    expect((await repository.auditTrail(created.id)).map((entry) => [entry.action, entry.actorId, entry.fields])).toEqual([
      ['contact.created', 'staff-editor', expect.arrayContaining(['email', 'tags', 'firstTouchAt'])],
      ['contact.updated', 'staff-admin', ['firstName', 'tags']],
    ]);
    expect(await repository.update('00000000-0000-4000-8000-000000000000', { firstName: 'X' }, 'staff-admin')).toBeNull();
  });

  it('turns unique email and person ID clashes into DuplicateContactError with the existing ID', async () => {
    const owner = await repository.insert(contact({ email: 'owner@example.test', corePersonId: 'core-p-9' }), 'staff-editor');
    await expect(repository.insert(contact({ email: 'owner@example.test' }), 'staff-editor')).rejects.toMatchObject({
      field: 'email',
      existingId: owner.id,
    });
    const clash = repository.insert(contact({ email: 'other@example.test', corePersonId: 'core-p-9' }), 'staff-editor');
    await expect(clash).rejects.toBeInstanceOf(DuplicateContactError);
    await expect(clash).rejects.toMatchObject({ field: 'corePersonId', existingId: owner.id });
  });

  it('searches email and full name, treats % literally, and filters by type, language and tag', async () => {
    await repository.insert(contact({ email: 'aram@example.test', firstName: 'Aram', lastName: null, language: 'en', type: 'lead', tags: [] }), 'staff-editor');
    await repository.insert(contact({ email: '100%sure@example.test', firstName: 'Mariam', tags: ['python'] }), 'staff-editor');
    const page = (filter: Parameters<typeof repository.list>[0]) => repository.list(filter);
    const all = { limit: 10, offset: 0 };

    expect((await page({ ...all, search: 'ANI PETRO' })).contacts.map((c) => c.email)).toEqual(['anna@example.test']);
    expect((await page({ ...all, search: '%' })).contacts.map((c) => c.email)).toEqual(['100%sure@example.test']);
    expect((await page({ ...all, type: 'lead', language: 'en' })).total).toBe(1);
    expect((await page({ ...all, tag: 'python' })).total).toBe(2);
    const first = await page({ limit: 1, offset: 0 });
    expect(first.contacts).toHaveLength(1);
    expect(first.total).toBe(4);
    // Newest first.
    expect(first.contacts[0]?.email).toBe('100%sure@example.test');
  });
});
