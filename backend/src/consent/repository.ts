import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, suppressions, type ConsentRecordRow, type SuppressionRow } from '../db/schema.js';
import type { ConsentMethod, ConsentState, Topic } from './wordings.js';

export type ConsentRecord = Omit<ConsentRecordRow, 'topic' | 'state' | 'method'> & {
  topic: Topic;
  state: ConsentState;
  method: ConsentMethod;
};

export type NewConsentRecord = Pick<
  ConsentRecord,
  'contactId' | 'topic' | 'state' | 'method' | 'wordingVersion' | 'sourceUrl' | 'ip' | 'actorId' | 'reason'
>;

export const SUPPRESSION_REASONS = ['unsubscribed', 'hard_bounce', 'complaint', 'erased'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type Suppression = Omit<SuppressionRow, 'reason'> & { reason: SuppressionReason };

export class ConsentRepository {
  constructor(private readonly db: AppPgDatabase) {}

  async insert(records: NewConsentRecord[]): Promise<ConsentRecord[]> {
    if (records.length === 0) return [];
    return (await this.db.insert(consentRecords).values(records).returning()) as ConsentRecord[];
  }

  /** All records of a contact, newest first. */
  async history(contactId: string): Promise<ConsentRecord[]> {
    return (await this.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactId))
      .orderBy(desc(consentRecords.createdAt), desc(consentRecords.id))) as ConsentRecord[];
  }

  /** Latest record per topic (12.4: the current state is the latest record). */
  async latest(contactId: string): Promise<Map<Topic, ConsentRecord>> {
    const rows = await this.history(contactId);
    const latest = new Map<Topic, ConsentRecord>();
    for (const row of rows) if (!latest.has(row.topic)) latest.set(row.topic, row);
    return latest;
  }

  async suppress(emailHash: string, reason: SuppressionReason, source: string): Promise<Suppression> {
    const [row] = await this.db.insert(suppressions).values({ emailHash, reason, source }).returning();
    return row as Suppression;
  }

  /** Active (not lifted) suppressions for an address, newest first. */
  async active(emailHash: string): Promise<Suppression[]> {
    return (await this.db
      .select()
      .from(suppressions)
      .where(and(eq(suppressions.emailHash, emailHash), isNull(suppressions.liftedAt)))
      .orderBy(desc(suppressions.createdAt))) as Suppression[];
  }

  /** Active suppression reasons per email hash, for bulk checks (imports, sends). */
  async activeByHashes(hashes: string[]): Promise<Map<string, SuppressionReason[]>> {
    const result = new Map<string, SuppressionReason[]>();
    for (let i = 0; i < hashes.length; i += 1000) {
      const rows = await this.db
        .select({ emailHash: suppressions.emailHash, reason: suppressions.reason })
        .from(suppressions)
        .where(and(inArray(suppressions.emailHash, hashes.slice(i, i + 1000)), isNull(suppressions.liftedAt)));
      for (const row of rows) result.set(row.emailHash, [...(result.get(row.emailHash) ?? []), row.reason as SuppressionReason]);
    }
    return result;
  }

  /** Lifts active "unsubscribed" rows only; bounces, complaints and erasure are never lifted. */
  async liftUnsubscribe(emailHash: string, source: string): Promise<number> {
    const rows = await this.db
      .update(suppressions)
      .set({ liftedAt: new Date(), liftSource: source })
      .where(and(eq(suppressions.emailHash, emailHash), eq(suppressions.reason, 'unsubscribed'), isNull(suppressions.liftedAt)))
      .returning({ id: suppressions.id });
    return rows.length;
  }

  /** Active suppressions by reason, for the Audience screen. */
  async summary(): Promise<Record<SuppressionReason, number>> {
    const rows = await this.db
      .select({ reason: suppressions.reason, value: count(sql`distinct ${suppressions.emailHash}`) })
      .from(suppressions)
      .where(isNull(suppressions.liftedAt))
      .groupBy(suppressions.reason);
    const totals: Record<SuppressionReason, number> = { unsubscribed: 0, hard_bounce: 0, complaint: 0, erased: 0 };
    for (const row of rows) totals[row.reason as SuppressionReason] = Number(row.value);
    return totals;
  }
}
