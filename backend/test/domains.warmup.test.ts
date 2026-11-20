import { describe, expect, it } from 'vitest';
import {
  academyDay,
  warmupDayNumber,
  warmupPlan,
  warmupState,
  WARMUP_FIRST_DAY_CAP,
  WARMUP_LAST_DAY_CAP,
} from '../src/domains/warmup.js';

describe('warm-up plan (EML-08)', () => {
  it.each([14, 21, 28])('rises from the first-day to the last-day cap over %i days, never dropping', (days) => {
    const plan = warmupPlan(days);
    expect(plan).toHaveLength(days);
    expect(plan[0]).toBe(WARMUP_FIRST_DAY_CAP);
    expect(plan.at(-1)).toBe(WARMUP_LAST_DAY_CAP);
    plan.slice(1).forEach((cap, index) => expect(cap).toBeGreaterThanOrEqual(plan[index] as number));
  });

  it('rounds caps to two significant figures', () => {
    expect(warmupPlan(21).every((cap) => /^\d{1,2}0*$/.test(String(cap)))).toBe(true);
  });

  it('counts days on the Yerevan calendar (UTC+4)', () => {
    // 19:59 UTC is 23:59 in Yerevan; 20:00 UTC is already the next day there.
    expect(academyDay(new Date('2026-11-21T19:59:00Z'))).toBe('2026-11-21');
    expect(academyDay(new Date('2026-11-21T20:00:00Z'))).toBe('2026-11-22');
    const start = new Date('2026-11-21T19:00:00Z');
    expect(warmupDayNumber(start, new Date('2026-11-21T19:59:00Z'))).toBe(1);
    expect(warmupDayNumber(start, new Date('2026-11-21T20:00:00Z'))).toBe(2);
  });

  it('moves through not started, active, complete and skipped', () => {
    const start = new Date('2026-11-01T08:00:00Z');
    const base = { warmupDays: 14, warmupStartedAt: null, warmupSkippedAt: null };
    expect(warmupState(base, start)).toMatchObject({ status: 'not_started', todayCap: null });

    const started = { ...base, warmupStartedAt: start };
    expect(warmupState(started, start)).toMatchObject({ status: 'active', day: 1, todayCap: WARMUP_FIRST_DAY_CAP });
    expect(warmupState(started, new Date('2026-11-14T08:00:00Z'))).toMatchObject({ status: 'active', day: 14, todayCap: WARMUP_LAST_DAY_CAP });
    expect(warmupState(started, new Date('2026-11-15T08:00:00Z'))).toMatchObject({ status: 'complete', todayCap: null });
    // A clock behind the start must still mean day 1, never "no cap".
    expect(warmupState(started, new Date('2026-10-30T08:00:00Z'))).toMatchObject({ status: 'active', day: 1 });

    expect(warmupState({ ...started, warmupSkippedAt: start }, start)).toMatchObject({ status: 'skipped', todayCap: null });
  });
});
