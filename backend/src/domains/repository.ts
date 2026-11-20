import { and, eq, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { domainDailySends, sendingDomains, type SendingDomainRow } from '../db/schema.js';
import type { CheckStatus, DmarcPolicy, DnsCheckResult, EspDomainIdentity } from './types.js';

export type SendingDomain = Omit<SendingDomainRow, 'spfStatus' | 'dkimStatus' | 'dmarcStatus' | 'trackingStatus' | 'dmarcPolicy'> & {
  spfStatus: CheckStatus;
  dkimStatus: CheckStatus;
  dmarcStatus: CheckStatus;
  trackingStatus: CheckStatus;
  dmarcPolicy: DmarcPolicy | null;
};

export type CheckUpdate = Pick<
  SendingDomain,
  | 'spfStatus'
  | 'dkimStatus'
  | 'dmarcStatus'
  | 'trackingStatus'
  | 'dmarcPolicy'
  | 'lastCheck'
  | 'lastCheckedAt'
  | 'verifiedAt'
  | 'warmupStartedAt'
>;

export type WarmupUpdate = Partial<Pick<SendingDomain, 'warmupDays' | 'warmupSkippedAt'>>;

export class DuplicateDomainError extends Error {
  constructor(readonly domain: string) {
    super(`Sending domain ${domain} already exists`);
    this.name = 'DuplicateDomainError';
  }
}

export interface DomainRepository {
  list(): Promise<SendingDomain[]>;
  findById(id: string): Promise<SendingDomain | null>;
  findByDomain(domain: string): Promise<SendingDomain | null>;
  /** Throws DuplicateDomainError when the domain is already registered. */
  insert(input: { domain: string; espIdentity: EspDomainIdentity }): Promise<SendingDomain>;
  saveCheck(id: string, update: CheckUpdate): Promise<SendingDomain | null>;
  updateWarmup(id: string, update: WarmupUpdate): Promise<SendingDomain | null>;
  delete(id: string): Promise<boolean>;
  /**
   * Counts one marketing message for the domain on that day if fewer than `cap` were counted so far.
   * Atomic: concurrent senders cannot pass the cap together. Returns false when the cap is reached.
   */
  reserveDailySend(domainId: string, day: string, cap: number): Promise<boolean>;
  sentOn(domainId: string, day: string): Promise<number>;
}


/** Statuses are plain text columns; the service only ever writes CheckStatus / DmarcPolicy values. */
const toDomain = (row: SendingDomainRow): SendingDomain => row as SendingDomain;

const isUniqueViolation = (error: unknown): boolean => {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((candidate) => (candidate as { code?: string } | null)?.code === '23505');
};

export class DrizzleDomainRepository implements DomainRepository {
  constructor(private readonly db: AppPgDatabase) {}

  async list() {
    const rows = await this.db.select().from(sendingDomains).orderBy(sendingDomains.createdAt);
    return rows.map(toDomain);
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(sendingDomains).where(eq(sendingDomains.id, id));
    return row ? toDomain(row) : null;
  }

  async findByDomain(domain: string) {
    const [row] = await this.db.select().from(sendingDomains).where(eq(sendingDomains.domain, domain));
    return row ? toDomain(row) : null;
  }

  async insert(input: { domain: string; espIdentity: EspDomainIdentity }) {
    try {
      const [row] = await this.db.insert(sendingDomains).values(input).returning();
      return toDomain(row as SendingDomainRow);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateDomainError(input.domain);
      throw error;
    }
  }

  async saveCheck(id: string, update: CheckUpdate) {
    const [row] = await this.db.update(sendingDomains).set(update).where(eq(sendingDomains.id, id)).returning();
    return row ? toDomain(row) : null;
  }

  async updateWarmup(id: string, update: WarmupUpdate) {
    const [row] = await this.db.update(sendingDomains).set(update).where(eq(sendingDomains.id, id)).returning();
    return row ? toDomain(row) : null;
  }

  async delete(id: string) {
    const rows = await this.db.delete(sendingDomains).where(eq(sendingDomains.id, id)).returning({ id: sendingDomains.id });
    return rows.length > 0;
  }

  async reserveDailySend(domainId: string, day: string, cap: number) {
    if (cap < 1) return false;
    // INSERT … ON CONFLICT DO UPDATE … WHERE sent < cap: one statement, row-locked by Postgres.
    const rows = await this.db
      .insert(domainDailySends)
      .values({ domainId, day, sent: 1 })
      .onConflictDoUpdate({
        target: [domainDailySends.domainId, domainDailySends.day],
        set: { sent: sql`${domainDailySends.sent} + 1`, updatedAt: new Date() },
        setWhere: sql`${domainDailySends.sent} < ${cap}`,
      })
      .returning({ sent: domainDailySends.sent });
    return rows.length > 0;
  }

  async sentOn(domainId: string, day: string) {
    const [row] = await this.db
      .select({ sent: domainDailySends.sent })
      .from(domainDailySends)
      .where(and(eq(domainDailySends.domainId, domainId), eq(domainDailySends.day, day)));
    return row?.sent ?? 0;
  }
}
