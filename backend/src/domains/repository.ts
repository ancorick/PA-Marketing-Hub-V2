import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../db/schema.js';
import { sendingDomains, type SendingDomainRow } from '../db/schema.js';
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
  'spfStatus' | 'dkimStatus' | 'dmarcStatus' | 'trackingStatus' | 'dmarcPolicy' | 'lastCheck' | 'lastCheckedAt' | 'verifiedAt'
>;

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
  delete(id: string): Promise<boolean>;
}

/** Any Drizzle Postgres database with our schema: node-postgres in production, PGlite in tests. */
export type AppPgDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

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

  async delete(id: string) {
    const rows = await this.db.delete(sendingDomains).where(eq(sendingDomains.id, id)).returning({ id: sendingDomains.id });
    return rows.length > 0;
  }
}

/** Used when DATABASE_URL is not set (local work without Postgres): data lives until restart. */
export class InMemoryDomainRepository implements DomainRepository {
  private readonly rows = new Map<string, SendingDomain>();

  async list() {
    return [...this.rows.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findByDomain(domain: string) {
    return [...this.rows.values()].find((row) => row.domain === domain) ?? null;
  }

  async insert(input: { domain: string; espIdentity: EspDomainIdentity }) {
    if (await this.findByDomain(input.domain)) throw new DuplicateDomainError(input.domain);
    const now = new Date();
    const row: SendingDomain = {
      id: randomUUID(),
      domain: input.domain,
      espIdentity: input.espIdentity,
      spfStatus: 'pending',
      dkimStatus: 'pending',
      dmarcStatus: 'pending',
      trackingStatus: 'pending',
      dmarcPolicy: null,
      lastCheck: null,
      lastCheckedAt: null,
      verifiedAt: null,
      warmupStage: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async saveCheck(id: string, update: CheckUpdate) {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, ...update, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string) {
    return this.rows.delete(id);
  }
}
