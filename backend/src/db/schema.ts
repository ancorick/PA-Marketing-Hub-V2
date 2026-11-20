// Drizzle schema for Marketing Hub (PRD section 12). Names are logical in the PRD; physical names below.
// Change a table here, then `npm run db:generate` (writes drizzle/*.sql) and `npm run db:migrate`.
import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  /** Warm-up plan (EML-08): length in days (14, 21 or 28). */
  warmupDays: integer('warmup_days').notNull().default(21),
  /** Day 1 of the plan: set when the domain first passes verification. */
  warmupStartedAt: timestamp('warmup_started_at', { withTimezone: true }),
  /** Set when an admin skips the plan for a domain that already has a sending reputation. */
  warmupSkippedAt: timestamp('warmup_skipped_at', { withTimezone: true }),
  ...timestamps,
});

export type SendingDomainRow = typeof sendingDomains.$inferSelect;

/**
 * Marketing messages per domain per Yerevan calendar day, for the warm-up daily cap (EML-08).
 * A slot is reserved atomically before each send, so concurrent batches cannot pass the cap.
 */
export const domainDailySends = pgTable(
  'domain_daily_sends',
  {
    domainId: uuid('domain_id')
      .notNull()
      .references(() => sendingDomains.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    sent: integer('sent').notNull().default(0),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.domainId, table.day] })],
);

/**
 * Contact (PRD 12.1, AUD-01, AUD-02): one record per person, linked to the Core Engine person when one exists.
 * Personal fields are nullable because erasure (AUD-18) replaces them with null and keeps the row.
 * Source channel and campaign are slugs from the 9.3 taxonomy until Channel/Campaign tables exist (phase 3).
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Core Engine person ID; the Core Engine stays the source of truth for the lifecycle (PRD 11.1). */
    corePersonId: text('core_person_id').unique(),
    /** Lower-cased and trimmed (PRD 12.4); unique, so one person has one record. */
    email: text('email').unique(),
    /** Digits with an optional leading "+", e.g. +37491234567. */
    phone: text('phone'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    /** hy | en | ru */
    language: text('language').notNull(),
    /** subscriber | lead | applicant | student | alumnus (PRD 6.1). */
    type: text('type').notNull(),
    sourceChannel: text('source_channel'),
    sourceCampaign: text('source_campaign'),
    firstTouchAt: timestamp('first_touch_at', { withTimezone: true }).notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** active | unsubscribed | bounced | complained | erased; changed by phase 1 suppression and erasure. */
    status: text('status').notNull().default('active'),
    /**
     * all | monthly: how often the person wants marketing email, set on the preferences page (AUD-11).
     * monthly = at most one marketing email in 30 days.
     */
    frequency: text('frequency').notNull().default('all'),
    ...timestamps,
  },
  (table) => [index('contacts_created_at_idx').on(table.createdAt)],
);

export type ContactRow = typeof contacts.$inferSelect;

/**
 * Audit row for every change to Contact, ConsentRecord, Segment, Send and Issue (PRD 12.4).
 * Stores which fields changed, never their values, so erasure (AUD-18) leaves no personal data here.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** e.g. contact.created, contact.updated */
    action: text('action').notNull(),
    /** Staff user ID from the Core Engine session. */
    actorId: text('actor_id').notNull(),
    fields: text('fields').array().notNull(),
    /** created_at is when the change happened; rows are append-only. */
    ...timestamps,
  },
  (table) => [index('audit_events_entity_idx').on(table.entityType, table.entityId, table.createdAt)],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;

/**
 * ConsentRecord (PRD 12.1, AUD-07): append-only; the current state per topic is the latest record (12.4).
 * pending = a website sign-up waiting for its confirmation click (AUD-08).
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** newsletter | courses | events | alumni */
    topic: text('topic').notNull(),
    /** granted | withdrawn | unknown | pending */
    state: text('state').notNull(),
    /** form | event | import | manual | link */
    method: text('method').notNull(),
    /** Version of the consent wording the person saw (6.3 rule 4); text in src/consent/wordings.ts. */
    wordingVersion: text('wording_version'),
    sourceUrl: text('source_url'),
    /** IP address or channel, where available. Erased with the contact (AUD-18). */
    ip: text('ip'),
    /** Staff user for manual changes. */
    actorId: text('actor_id'),
    /** Required for manual changes (6.3 rule 5). */
    reason: text('reason'),
    ...timestamps,
  },
  (table) => [index('consent_records_contact_idx').on(table.contactId, table.topic, table.createdAt)],
);

export type ConsentRecordRow = typeof consentRecords.$inferSelect;

/**
 * Global suppression list (PRD 12.1, AUD-12). Keyed by a hash of the normalized email so it survives
 * erasure. Rows are never deleted; only an "unsubscribed" row can be lifted, and only by the person's own
 * confirmed action (undo on the unsubscribe page, preferences page, confirmed sign-up).
 */
export const suppressions = pgTable(
  'suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailHash: text('email_hash').notNull(),
    /** unsubscribed | hard_bounce | complaint | erased */
    reason: text('reason').notNull(),
    /** Where it came from: link, list_unsubscribe, preferences, esp_webhook, manual, erasure … */
    source: text('source').notNull(),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftSource: text('lift_source'),
    ...timestamps,
  },
  (table) => [index('suppressions_email_hash_idx').on(table.emailHash)],
);

export type SuppressionRow = typeof suppressions.$inferSelect;
