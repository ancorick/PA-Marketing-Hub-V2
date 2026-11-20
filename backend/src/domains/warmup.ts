/**
 * Warm-up plan for a new sending domain (PRD EML-08, R3): the daily cap on marketing email rises over
 * two to four weeks so mailbox providers learn to trust the domain. Days follow the Academy's calendar.
 */
export const WARMUP_LENGTHS = [14, 21, 28] as const;
export type WarmupLength = (typeof WARMUP_LENGTHS)[number];
export const DEFAULT_WARMUP_DAYS: WarmupLength = 21;

/** Day 1 sends to seed, internal and most engaged contacts only; the last day reaches full list size. */
export const WARMUP_FIRST_DAY_CAP = 50;
export const WARMUP_LAST_DAY_CAP = 10_000;

export const ACADEMY_TIME_ZONE = 'Asia/Yerevan';

export const isWarmupLength = (value: number): value is WarmupLength =>
  (WARMUP_LENGTHS as readonly number[]).includes(value);

/** Two significant figures, so caps read as plans, not as formulas: 1,234 → 1,200. */
function roundCap(value: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / step) * step;
}

/** Daily caps for days 1…N, rising geometrically from the first-day to the last-day cap. */
export function warmupPlan(days: number): number[] {
  const growth = (WARMUP_LAST_DAY_CAP / WARMUP_FIRST_DAY_CAP) ** (1 / (days - 1));
  return Array.from({ length: days }, (_, index) => roundCap(WARMUP_FIRST_DAY_CAP * growth ** index));
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACADEMY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Yerevan as YYYY-MM-DD (the key of the daily send counter). */
export function academyDay(date: Date): string {
  return dayFormat.format(date);
}

/** 1 on the start day, 2 the next Yerevan day, and so on. */
export function warmupDayNumber(startedAt: Date, now: Date): number {
  const toUtcDays = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  return toUtcDays(academyDay(now)) - toUtcDays(academyDay(startedAt)) + 1;
}

export type WarmupState = {
  /** not_started: the domain has not passed verification yet; complete: the plan has run its course. */
  status: 'not_started' | 'active' | 'complete' | 'skipped';
  days: number;
  /** Current day of the plan while active. */
  day: number | null;
  /** Today's cap on marketing email from this domain; null when there is none. */
  todayCap: number | null;
  plan: number[];
};

export function warmupState(
  domain: { warmupDays: number; warmupStartedAt: Date | null; warmupSkippedAt: Date | null },
  now: Date,
): WarmupState {
  const plan = warmupPlan(domain.warmupDays);
  const base = { days: domain.warmupDays, plan };
  if (domain.warmupSkippedAt) return { ...base, status: 'skipped', day: null, todayCap: null };
  if (!domain.warmupStartedAt) return { ...base, status: 'not_started', day: null, todayCap: null };
  // Clamped: a clock behind the start time must never mean "no cap".
  const day = Math.max(1, warmupDayNumber(domain.warmupStartedAt, now));
  if (day > domain.warmupDays) return { ...base, status: 'complete', day: null, todayCap: null };
  return { ...base, status: 'active', day, todayCap: plan[day - 1] ?? null };
}
