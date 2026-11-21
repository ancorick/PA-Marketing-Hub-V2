import { describe, expect, it } from 'vitest';
import { isoWeek, lastFullQuarter } from '../src/analytics/metrics.js';
import { outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

type M = { id: string; status: string; value: string; detail: string };

describe('success metrics M1–M11 (PRD 3.2, 17.1)', () => {
  it('works out ISO weeks and the last full quarter', () => {
    expect(isoWeek(new Date('2026-11-21T12:00:00Z'))).toBe('2026-W47');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(lastFullQuarter(new Date('2026-11-21T12:00:00Z'))).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(lastFullQuarter(new Date('2026-02-10T12:00:00Z'))).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('reports every metric, "no data" where nothing can be measured yet, and measures what exists', async () => {
    const app = await buildTestApp();
    const empty = (await app.inject({ method: 'GET', url: '/api/analytics/metrics', headers: bearer('leadership') })).json().metrics as M[];
    expect(empty.map((m) => m.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11']);
    expect(empty.filter((m) => m.status === 'no_data').map((m) => m.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11']);

    // M1: two enrolled in the last full quarter, one with a tracked first touch.
    const { db } = await currentTestDatabase();
    const quarter = lastFullQuarter(new Date());
    const tracked = await app.contacts.create({ email: 'tracked@example.test', language: 'hy', sourceChannel: 'paid_social', firstTouchAt: new Date(`${quarter.from}T10:00:00+04:00`) }, { userId: 'test' });
    await db.insert(outcomes).values([
      { contactId: tracked.id, type: 'enrolled', occurredAt: new Date(`${quarter.to}T10:00:00+04:00`), sourceSystem: 'test', sourceRef: 'e1' },
      { contactId: null, corePersonId: 'p-unknown', type: 'enrolled', occurredAt: new Date(`${quarter.to}T10:00:00+04:00`), sourceSystem: 'test', sourceRef: 'e2' },
    ]);
    // M3: an obvious duplicate pair.
    await app.contacts.create({ email: 'anna.p+news@gmail.com', language: 'hy', sourceChannel: 'email' }, { userId: 'test' });
    await app.contacts.create({ email: 'annap@gmail.com', language: 'hy', sourceChannel: 'email' }, { userId: 'test' });
    // M11: two marketing staff open the Overview this week.
    for (const role of ['editor', 'marketing_manager', 'leadership'])
      await app.inject({ method: 'GET', url: '/api/analytics/overview?from=2026-10-01&to=2026-10-31', headers: bearer(role) });

    const metrics = Object.fromEntries(((await app.inject({ method: 'GET', url: '/api/analytics/metrics', headers: bearer('admin') })).json().metrics as M[]).map((m) => [m.id, m]));
    expect(metrics.M1).toMatchObject({ value: '50.0%', status: 'misses', detail: '1 of 2 enrolled students' });
    expect(metrics.M3).toMatchObject({ status: 'misses', detail: '1 suggested pairs among 3 contacts' });
    expect(metrics.M5).toMatchObject({ status: 'meets', value: 'Immediate' });
    expect(metrics.M11).toMatchObject({ value: '2 this week' });
    await app.close();
  });
});
