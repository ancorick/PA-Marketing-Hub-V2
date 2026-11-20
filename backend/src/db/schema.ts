// Drizzle schema for Marketing Hub (PRD section 12). Names are logical in the PRD; physical names below.
// Change a table here, then `npm run db:generate` (writes drizzle/*.sql) and `npm run db:migrate`.
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    /**
     * Duplicate-detection key (AUD-04, 12.4): plus tags removed, Gmail dots removed. Not unique: two
     * records with the same key are a suggested merge, not an error.
     */
    emailKey: text('email_key'),
    /** The CSV import that created the record (7.4 guardrail on an import's first send). */
    importId: uuid('import_id'),
    /** Navigator CRM lead and its current stage (AUD-06); AUD-17 excludes active admissions stages. */
    crmLeadId: text('crm_lead_id').unique(),
    crmStage: text('crm_stage'),
    /** "How did you hear about us?" from the CRM application form (purpose: ANL-16). */
    selfReportedSource: text('self_reported_source'),
    /** Alumni Tracker: employed | seeking | not_seeking (purpose: segments in 6.4, e.g. "alumni, hired"). */
    employmentStatus: text('employment_status'),
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
  (table) => [
    index('contacts_created_at_idx').on(table.createdAt),
    index('contacts_email_key_idx').on(table.emailKey),
    index('contacts_phone_idx').on(table.phone),
    index('contacts_import_idx').on(table.importId),
  ],
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

/**
 * Touchpoint (PRD 12.1): one marketing interaction (visit, form, click, open, registration, attendance, chat,
 * referral). Channel and campaign are slugs (9.3 taxonomy, utm_campaign) until the Channel and Campaign
 * tables arrive in phase 3. contact_id is null for anonymous touchpoints and after a merge target is gone.
 */
export const touchpoints = pgTable(
  'touchpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    channel: text('channel'),
    campaign: text('campaign'),
    type: text('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** website, esp, event_hub, crm, chatbot … */
    sourceSystem: text('source_system').notNull(),
    /** ID or URL in the source system, for idempotent re-imports. */
    sourceRef: text('source_ref'),
    ...timestamps,
  },
  (table) => [
    index('touchpoints_contact_idx').on(table.contactId, table.occurredAt),
    index('touchpoints_occurred_idx').on(table.occurredAt),
  ],
);

export type TouchpointRow = typeof touchpoints.$inferSelect;

/** CSV import (AUD-03): who imported what, with the outcome counts shown after commit. */
export const contactImports = pgTable('contact_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: text('file_name').notNull(),
  actorId: text('actor_id').notNull(),
  rowsTotal: integer('rows_total').notNull(),
  created: integer('created').notNull(),
  updated: integer('updated').notNull(),
  invalid: integer('invalid').notNull(),
  /** Column mapping and options used, for the record. */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export type ContactImportRow = typeof contactImports.$inferSelect;

/** Pairs a reviewer marked as different people (AUD-04): never suggested again. */
export const duplicateDismissals = pgTable(
  'duplicate_dismissals',
  {
    /** The smaller of the two contact IDs first, so each pair is stored once. */
    contactA: uuid('contact_a').notNull(),
    contactB: uuid('contact_b').notNull(),
    actorId: text('actor_id').notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.contactA, table.contactB] })],
);

/**
 * Outcome (PRD 12.1): lead, applied, enrolled, completed, hired, mirrored from Navigator CRM, the Core
 * Engine and Alumni Tracker (AUD-06). Unique per source record, so re-running a sync never double-counts.
 */
export const outcomes = pgTable(
  'outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    corePersonId: text('core_person_id'),
    /** lead | applied | enrolled | completed | hired */
    type: text('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    courseId: text('course_id'),
    groupId: text('group_id'),
    /** core_engine | navigator_crm | alumni_tracker */
    sourceSystem: text('source_system').notNull(),
    sourceRef: text('source_ref').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('outcomes_source_idx').on(table.sourceSystem, table.sourceRef, table.type),
    index('outcomes_contact_idx').on(table.contactId, table.occurredAt),
  ],
);

export type OutcomeRow = typeof outcomes.$inferSelect;

/** SyncRun (PRD 12.3): every scheduled job run, for the jobs screen, Data Health (ANL-11) and alerts. */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Job name, e.g. core_people, crm_leads. */
    source: text('source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** running | ok | failed */
    status: text('status').notNull(),
    rowsIn: integer('rows_in').notNull().default(0),
    rowsUpserted: integer('rows_upserted').notNull().default(0),
    error: text('error'),
    /** Window pulled; the next run starts from window_to minus the overlap. */
    windowFrom: timestamp('window_from', { withTimezone: true }),
    windowTo: timestamp('window_to', { withTimezone: true }),
    /** manual runs name the staff member; scheduled runs say "scheduler". */
    triggeredBy: text('triggered_by').notNull(),
    ...timestamps,
  },
  (table) => [index('sync_runs_source_idx').on(table.source, table.startedAt)],
);

export type SyncRunRow = typeof syncRuns.$inferSelect;

/**
 * Segment (PRD 12.1, AUD-13 to AUD-15). Dynamic segments store a rule (JSON, validated against a whitelist
 * and compiled to parameterized SQL, NFR-S7) and are recalculated at send time; static lists store members.
 */
export const segments = pgTable('segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  /** dynamic | static */
  type: text('type').notNull(),
  rule: jsonb('rule').$type<unknown>(),
  ownerId: text('owner_id').notNull(),
  /** Members at the last count, for the list screen; the real audience is computed at send time. */
  lastCount: integer('last_count'),
  lastCountedAt: timestamp('last_counted_at', { withTimezone: true }),
  ...timestamps,
});

export type SegmentRow = typeof segments.$inferSelect;

/** Members of static lists (AUD-15), e.g. guests of a specific event. */
export const segmentMembers = pgTable(
  'segment_members',
  {
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    addedBy: text('added_by').notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.segmentId, table.contactId] }), index('segment_members_contact_idx').on(table.contactId)],
);

/**
 * Send (PRD 12.2): one email to a segment, from draft to sent (Flow B). Content lives on the send until
 * reusable templates arrive with the newsletter (NWS-15).
 */
export const sends = pgTable(
  'sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** campaign | newsletter | reengagement */
    kind: text('kind').notNull().default('campaign'),
    /** Consent topic recipients must have granted (6.3 rule 1). */
    topic: text('topic').notNull(),
    /** recruitment: contacts in an active admissions stage are left out unless included on purpose (AUD-17). */
    purpose: text('purpose').notNull().default('other'),
    includeActiveAdmissions: boolean('include_active_admissions').notNull().default(false),
    segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'set null' }),
    language: text('language').notNull(),
    /** Local part of the From address; the domain is the verified sending domain. */
    fromName: text('from_name').notNull(),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    preheader: text('preheader'),
    /** Body in a small, safe markup: paragraphs, **bold**, [links](https://…), ![alt](https://image). */
    body: text('body').notNull(),
    buttonLabel: text('button_label'),
    buttonUrl: text('button_url'),
    /** utm_campaign added to every link (Flow B step 2, ANL-04). */
    utmCampaign: text('utm_campaign').notNull(),
    /** draft | approved | scheduled | sending | paused | sent | cancelled */
    status: text('status').notNull().default('draft'),
    pausedReason: text('paused_reason'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    sentCount: integer('sent_count').notNull().default(0),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [index('sends_status_idx').on(table.status, table.scheduledAt)],
);

export type SendRow = typeof sends.$inferSelect;

/**
 * Delivery (PRD 12.2, EML-10, EML-16): one row per send and contact, unique, so a contact can never get the
 * same send twice. Status: queued | sending | sent | delivered | bounced_soft | bounced_hard | complained |
 * skipped (suppressed or frequency at send time) | failed | unknown (a crash between the ESP call and saving).
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sendId: uuid('send_id')
      .notNull()
      .references(() => sends.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    email: text('email'),
    status: text('status').notNull().default('queued'),
    skipReason: text('skip_reason'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    espMessageId: text('esp_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    firstClickAt: timestamp('first_click_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('deliveries_send_contact_idx').on(table.sendId, table.contactId),
    index('deliveries_status_idx').on(table.sendId, table.status),
    index('deliveries_esp_idx').on(table.espMessageId),
    index('deliveries_contact_idx').on(table.contactId, table.sentAt),
  ],
);

export type DeliveryRow = typeof deliveries.$inferSelect;

/** Kill switch (EML-14) and other single-row settings. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: text('updated_by').notNull(),
  ...timestamps,
});
