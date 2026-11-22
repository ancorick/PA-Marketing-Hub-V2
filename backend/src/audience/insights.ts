import { and, count, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { suppress, type Count } from '../analytics/overview.js';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, contacts, segments, suppressions } from '../db/schema.js';

const YEREVAN = 4 * 3_600_000;
const monthOf = (at: Date) => new Date(at.getTime() + YEREVAN).toISOString().slice(0, 7);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** The latest newsletter consent state of each contact (12.4: the latest record wins); none = unknown. */
const latestNewsletter = sql<string | null>`(select ${consentRecords.state} from ${consentRecords} where ${consentRecords.contactId} = ${contacts.id} and ${consentRecords.topic} = 'newsletter' order by ${consentRecords.createdAt} desc limit 1)`;

export type ConsentState = 'granted' | 'withdrawn' | 'pending' | 'unknown';

/**
 * Audience aggregates for REACH (RESTRUCTURE R4; PRD 6, 13.6, metrics M3/M4): the metric strip of Contacts and
 * the Audience health page. Counts only, so every staff role may read them; small numbers are hidden outside
 * marketing (ANL-14).
 */
export class AudienceInsights {
  constructor(private readonly deps: { db: AppPgDatabase; now?: () => Date }) {}

  /** Contacts strip: everyone, with newsletter consent, unsubscribed, and active suppressions. */
  async summary(shared: boolean) {
    const [[totals], [suppressed]] = await Promise.all([
      this.deps.db
        .select({
          total: count(),
          withConsent: sql<number>`count(*) filter (where ${contacts.status} = 'active' and ${latestNewsletter} = 'granted')`,
          unsubscribed: sql<number>`count(*) filter (where ${contacts.status} = 'unsubscribed')`,
        })
        .from(contacts)
        .where(ne(contacts.status, 'erased')),
      this.deps.db.select({ value: count() }).from(suppressions).where(isNull(suppressions.liftedAt)),
    ]);
    return {
      total: suppress(Number(totals?.total ?? 0), shared),
      withConsent: suppress(Number(totals?.withConsent ?? 0), shared),
      unsubscribed: suppress(Number(totals?.unsubscribed ?? 0), shared),
      suppressed: suppress(Number(suppressed?.value ?? 0), shared),
    };
  }

  /** Latest newsletter consent per contact, for the Newsletter consent column of the contact list. */
  async newsletterStates(ids: string[]): Promise<Map<string, ConsentState>> {
    if (ids.length === 0) return new Map();
    const rows = await this.deps.db
      .selectDistinctOn([consentRecords.contactId], { contactId: consentRecords.contactId, state: consentRecords.state })
      .from(consentRecords)
      .where(and(inArray(consentRecords.contactId, ids), eq(consentRecords.topic, 'newsletter')))
      .orderBy(consentRecords.contactId, desc(consentRecords.createdAt));
    return new Map(rows.map((row) => [row.contactId, row.state as ConsentState]));
  }

  /**
   * Audience health: size, newsletter consent coverage, lifecycle type and language mix, new contacts per month
   * (18 months, by the month the record was created), people leaving the list per month (12 months: unsubscribes,
   * hard bounces and complaints recorded on the suppression list) and the largest segments.
   */
  async health(shared: boolean) {
    const now = this.deps.now?.() ?? new Date();
    const current = monthOf(now);
    const firstNew = addMonths(current, -17);
    const firstLeaving = addMonths(current, -11);
    const since = (month: string) => new Date(new Date(`${month}-01T00:00:00Z`).getTime() - YEREVAN);
    const live = ne(contacts.status, 'erased');
    const [consent, byType, byLanguage, created, leaving, largest] = await Promise.all([
      this.deps.db
        .select({ state: sql<string>`coalesce(${latestNewsletter}, 'unknown')`, value: count() })
        .from(contacts)
        .where(live)
        .groupBy(sql`1`),
      this.deps.db.select({ key: contacts.type, value: count() }).from(contacts).where(live).groupBy(contacts.type),
      this.deps.db.select({ key: contacts.language, value: count() }).from(contacts).where(live).groupBy(contacts.language),
      this.deps.db
        .select({ month: sql<string>`to_char(${contacts.createdAt} + interval '4 hours', 'YYYY-MM')`, value: count() })
        .from(contacts)
        .where(gte(contacts.createdAt, since(firstNew)))
        .groupBy(sql`1`),
      this.deps.db
        .select({ month: sql<string>`to_char(${suppressions.createdAt} + interval '4 hours', 'YYYY-MM')`, reason: suppressions.reason, value: count() })
        .from(suppressions)
        .where(and(gte(suppressions.createdAt, since(firstLeaving)), inArray(suppressions.reason, ['unsubscribed', 'hard_bounce', 'complaint'])))
        .groupBy(sql`1`, suppressions.reason),
      this.deps.db
        .select({ id: segments.id, name: segments.name, type: segments.type, count: segments.lastCount })
        .from(segments)
        .where(isNotNull(segments.lastCount))
        .orderBy(desc(segments.lastCount))
        .limit(8),
    ]);
    const n = (value: number) => suppress(Number(value), shared);
    const consentCounts = Object.fromEntries(['granted', 'withdrawn', 'pending', 'unknown'].map((state) => [state, Number(consent.find((row) => row.state === state)?.value ?? 0)])) as Record<ConsentState, number>;
    const total = Object.values(consentCounts).reduce((sum, value) => sum + value, 0);
    const createdBy = new Map(created.map((row) => [row.month, Number(row.value)]));
    const leavingOf = (month: string, reason: string) => Number(leaving.find((row) => row.month === month && row.reason === reason)?.value ?? 0);
    return {
      checkedAt: now.toISOString(),
      shared,
      total: n(total),
      consent: Object.fromEntries(Object.entries(consentCounts).map(([state, value]) => [state, n(value)])) as Record<ConsentState, Count>,
      // Share of contacts with a newsletter consent record other than "unknown" (granted, withdrawn or pending).
      consentRecordedRate: total > 0 ? (total - consentCounts.unknown) / total : null,
      grantedRate: total > 0 ? consentCounts.granted / total : null,
      byType: byType.map((row) => ({ key: row.key, count: n(row.value) })).sort((a, b) => Number(b.count) - Number(a.count)),
      byLanguage: byLanguage.map((row) => ({ key: row.key, count: n(row.value) })).sort((a, b) => Number(b.count) - Number(a.count)),
      newPerMonth: Array.from({ length: 18 }, (_, i) => addMonths(firstNew, i)).map((month) => ({ month, count: n(createdBy.get(month) ?? 0) })),
      leavingPerMonth: Array.from({ length: 12 }, (_, i) => addMonths(firstLeaving, i)).map((month) => ({
        month,
        unsubscribed: n(leavingOf(month, 'unsubscribed')),
        bounced: n(leavingOf(month, 'hard_bounce')),
        complaints: n(leavingOf(month, 'complaint')),
      })),
      largestSegments: largest.map((row) => ({ id: row.id, name: row.name, type: row.type, count: n(row.count ?? 0) })),
    };
  }
}
