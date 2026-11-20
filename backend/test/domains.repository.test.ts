import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { DrizzleDomainRepository, DuplicateDomainError } from '../src/domains/repository.js';
import type { EspDomainIdentity } from '../src/domains/types.js';

// Runs the real SQL migrations on an in-process Postgres (PGlite), then the Drizzle repository on top.
const client = new PGlite();
const db = drizzle({ client, schema });
const repository = new DrizzleDomainRepository(db);

const identity: EspDomainIdentity = {
  provider: 'log',
  placeholder: true,
  spfInclude: 'spf.esp-not-chosen.invalid',
  dkim: [{ selector: 'mh1', type: 'CNAME', value: 'mh1.dkim.esp-not-chosen.invalid' }],
  trackingLabel: 'click',
  trackingTarget: 'track.esp-not-chosen.invalid',
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
});

afterAll(async () => {
  await client.close();
});

describe('DrizzleDomainRepository on the migrated schema', () => {
  it('stores, finds, updates and deletes a sending domain', async () => {
    const created = await repository.insert({ domain: 'news.academy.example', espIdentity: identity });
    expect(created).toMatchObject({ spfStatus: 'pending', warmupDays: 21, warmupStartedAt: null, verifiedAt: null, espIdentity: identity });
    expect(await repository.findByDomain('news.academy.example')).toEqual(created);

    const checkedAt = new Date('2026-11-20T10:00:00Z');
    const lastCheck = { checkedAt: checkedAt.toISOString(), records: [], dmarcPolicy: 'none' as const };
    const updated = await repository.saveCheck(created.id, {
      spfStatus: 'verified',
      dkimStatus: 'verified',
      dmarcStatus: 'verified',
      trackingStatus: 'missing',
      dmarcPolicy: 'none',
      lastCheck,
      lastCheckedAt: checkedAt,
      verifiedAt: checkedAt,
      warmupStartedAt: checkedAt,
    });
    expect(updated).toMatchObject({ spfStatus: 'verified', trackingStatus: 'missing', lastCheck, verifiedAt: checkedAt });
    expect(await repository.list()).toHaveLength(1);

    expect(await repository.delete(created.id)).toBe(true);
    expect(await repository.findById(created.id)).toBeNull();
    expect(await repository.delete(created.id)).toBe(false);
  });

  it('turns the unique constraint into DuplicateDomainError', async () => {
    await repository.insert({ domain: 'mail.academy.example', espIdentity: identity });
    await expect(repository.insert({ domain: 'mail.academy.example', espIdentity: identity })).rejects.toBeInstanceOf(
      DuplicateDomainError,
    );
  });
});

describe('warm-up on the migrated schema (EML-08)', () => {
  it('never lets concurrent reservations pass the daily cap', async () => {
    const domain = await repository.insert({ domain: 'warm.academy.example', espIdentity: identity });
    const results = await Promise.all(Array.from({ length: 25 }, () => repository.reserveDailySend(domain.id, '2026-11-21', 10)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await repository.sentOn(domain.id, '2026-11-21')).toBe(10);
    // A new day starts from zero.
    expect(await repository.reserveDailySend(domain.id, '2026-11-22', 10)).toBe(true);
    expect(await repository.sentOn(domain.id, '2026-11-22')).toBe(1);
  });

  it('stores plan changes and drops counters with the domain', async () => {
    const domain = await repository.insert({ domain: 'plan.academy.example', espIdentity: identity });
    const skippedAt = new Date('2026-11-21T08:00:00Z');
    expect(await repository.updateWarmup(domain.id, { warmupDays: 14, warmupSkippedAt: skippedAt })).toMatchObject({
      warmupDays: 14,
      warmupSkippedAt: skippedAt,
    });
    await repository.reserveDailySend(domain.id, '2026-11-21', 5);
    await repository.delete(domain.id);
    expect(await repository.sentOn(domain.id, '2026-11-21')).toBe(0);
  });
});
