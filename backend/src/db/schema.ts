// Drizzle schema for Marketing Hub (PRD section 12). Names are logical in the PRD; physical names below.
// Change a table here, then `npm run db:generate` (writes drizzle/*.sql) and `npm run db:migrate`.
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DnsCheckResult, EspDomainIdentity } from '../domains/types.js';

/** Every table has created_at and updated_at (PRD 12.4). */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** SendingDomain (PRD 12.2): the authenticated subdomain marketing email leaves from (7.1, 7.2). */
export const sendingDomains = pgTable('sending_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Lower-case host name, e.g. news.academy-domain.am. */
  domain: text('domain').notNull().unique(),
  /** What the ESP asked us to publish when the domain was registered with it (EML-02). */
  espIdentity: jsonb('esp_identity').$type<EspDomainIdentity>().notNull(),
  /** pending (never checked) | verified | missing | invalid | error, per mechanism. */
  spfStatus: text('spf_status').notNull().default('pending'),
  dkimStatus: text('dkim_status').notNull().default('pending'),
  dmarcStatus: text('dmarc_status').notNull().default('pending'),
  trackingStatus: text('tracking_status').notNull().default('pending'),
  /** Policy found in the published DMARC record: none | quarantine | reject. */
  dmarcPolicy: text('dmarc_policy'),
  /** Details of the last live check, shown on the domain setup screen. */
  lastCheck: jsonb('last_check').$type<DnsCheckResult>(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  /** Set while SPF, DKIM and DMARC all pass; cleared when a later check fails (EML-03). */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** Warm-up plan stage (EML-08); 0 = not started. */
  warmupStage: integer('warmup_stage').notNull().default(0),
  ...timestamps,
});

export type SendingDomainRow = typeof sendingDomains.$inferSelect;
