import { describe, expect, it } from 'vitest';
import { contacts, outcomes, touchpoints } from '../src/db/schema.js';
import { buildTestApp, currentTestDatabase } from './helpers.js';

/**
 * NFR-F1: the Overview for 24 months answers in under 2 seconds. Volume about three years of a small academy:
 * 6,000 contacts, 30,000 touches, 7,000 outcomes. Embedded Postgres in a test process is slower than Neon,
 * so passing here leaves headroom in production.
 */
describe('Overview performance (NFR-F1)', () => {
  it('answers a 24-month Overview in under 2 seconds', { timeout: 120_000 }, async () => {
    const app = await buildTestApp();
    const { db } = await currentTestDatabase();
    const channels = ['paid_social', 'organic_social', 'search_website', 'paid_search', 'email', 'events', 'referrals'];
    const start = Date.parse('2024-11-22T00:00:00Z');
    const span = 730 * 86_400_000;
    const ids: string[] = [];
    for (let batch = 0; batch < 6; batch += 1) {
      const rows = Array.from({ length: 1000 }, (_, i) => {
        const n = batch * 1000 + i;
        return {
          email: `perf${n}@example.test`,
          emailKey: `perf${n}@example.test`,
          language: 'hy',
          type: 'lead',
          status: 'active',
          sourceChannel: channels[n % channels.length],
          firstTouchAt: new Date(start + ((n * 7919) % span)),
          tags: [],
        };
      });
      const inserted = await db.insert(contacts).values(rows as never).returning({ id: contacts.id, at: contacts.firstTouchAt });
      ids.push(...inserted.map((row) => row.id));
      const touches = inserted.flatMap((row, i) =>
        Array.from({ length: 5 }, (_, k) => ({
          contactId: row.id,
          channel: channels[(i + k) % channels.length],
          campaign: `campaign-${(i + k) % 12}`,
          type: 'click',
          occurredAt: new Date(row.at.getTime() + k * 5 * 86_400_000),
          sourceSystem: 'perf',
          sourceRef: null,
        })),
      );
      for (let i = 0; i < touches.length; i += 1000) await db.insert(touchpoints).values(touches.slice(i, i + 1000));
      const results = inserted.flatMap((row, i) => [
        { contactId: row.id, type: 'lead', occurredAt: new Date(row.at.getTime() + 86_400_000), sourceSystem: 'perf', sourceRef: `l${batch}-${i}` },
        ...(i % 5 === 0 ? [{ contactId: row.id, type: 'applied', occurredAt: new Date(row.at.getTime() + 30 * 86_400_000), sourceSystem: 'perf', sourceRef: `a${batch}-${i}` }] : []),
        ...(i % 10 === 0 ? [{ contactId: row.id, type: 'enrolled', occurredAt: new Date(row.at.getTime() + 60 * 86_400_000), sourceSystem: 'perf', sourceRef: `e${batch}-${i}` }] : []),
      ]);
      for (let i = 0; i < results.length; i += 1000) await db.insert(outcomes).values(results.slice(i, i + 1000));
    }
    const timings: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const began = performance.now();
      const body = await app.overview.overview({ from: '2024-11-22', to: '2026-11-21' }, 'position_based', false);
      timings.push(performance.now() - began);
      expect(body.totals.lead).toBeGreaterThan(5000);
    }
    console.log(`Overview 24 months, 6,000 contacts: ${timings.map((t) => Math.round(t)).join(' / ')} ms`);
    expect(Math.min(...timings)).toBeLessThan(2000);
    await app.close();
  });
});
