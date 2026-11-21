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
    /** Sunset policy (EML-15): when the re-engagement email went out, and when the contact left regular sends. */
    reengagementSentAt: timestamp('reengagement_sent_at', { withTimezone: true }),
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
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
    /** Campaign parameters as received, so a later taxonomy rule can map an unmapped touchpoint (ANL-03). */
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
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
  /** 7.4: more than 10% hard bounces on the import's first send blocks its contacts until reviewed. */
  sendBlockedAt: timestamp('send_blocked_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
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
  /** Event Hub may pull it for invitations (EVT-07); set by a marketing manager, off by default. */
  sharedWithEventHub: boolean('shared_with_event_hub').notNull().default(false),
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
    /** Newsletter sends: the issue, and the approved blocks and template frozen at approval (what was approved is sent). */
    issueId: uuid('issue_id'),
    /** NWS-16 subject A/B test: variant B, sample size, when to pick the winner, and the winner. */
    subjectB: text('subject_b'),
    abSamplePercent: integer('ab_sample_percent'),
    abWaitHours: integer('ab_wait_hours'),
    abDecideAt: timestamp('ab_decide_at', { withTimezone: true }),
    abWinner: text('ab_winner'),
    blocks: jsonb('blocks').$type<unknown[]>(),
    theme: jsonb('theme').$type<Record<string, unknown>>(),
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
    /** queued … plus held: waiting for the A/B winner (NWS-16). */
    status: text('status').notNull().default('queued'),
    /** NWS-16: subject variant this message gets (A or B); null when the send has no test. */
    variant: text('variant'),
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

/** ESP webhook events already processed (EML-04): providers retry, so each event ID is handled once. */
export const espEvents = pgTable('esp_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  messageId: text('message_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

/**
 * Alerts for staff (PRD 7.4 guardrails, 14.4 job failures, ANL-11): shown in the app to the roles named;
 * resolved by a person, never deleted.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** warning | critical */
    level: text('level').notNull(),
    roles: text('roles').array().notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    /** In-app link, e.g. #/campaigns/<id>. */
    link: text('link'),
    /** Same key while unresolved = same alert, so a repeating problem does not flood the list. */
    dedupeKey: text('dedupe_key'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    ...timestamps,
  },
  (table) => [index('alerts_open_idx').on(table.resolvedAt, table.createdAt)],
);

export type AlertRow = typeof alerts.$inferSelect;

/** Export log (AUD-19): every export of contact data with who, when, what and how many rows. */
export const exportLog = pgTable('export_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id').notNull(),
  /** segment_csv | contact_data (NFR-P4 access request) */
  kind: text('kind').notNull(),
  segmentId: uuid('segment_id'),
  segmentName: text('segment_name'),
  contactId: uuid('contact_id'),
  rowCount: integer('row_count').notNull(),
  ...timestamps,
});

/** DMARC aggregate report (EML-07): one per reporting organisation and report ID, so re-uploads are ignored. */
export const dmarcReports = pgTable(
  'dmarc_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgName: text('org_name').notNull(),
    reportId: text('report_id').notNull(),
    domain: text('domain').notNull(),
    policy: text('policy'),
    dateBegin: timestamp('date_begin', { withTimezone: true }).notNull(),
    dateEnd: timestamp('date_end', { withTimezone: true }).notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('dmarc_reports_org_report_idx').on(table.orgName, table.reportId)],
);

/**
 * One row of a DMARC report: a sending IP and how its messages fared. category: pass (DMARC aligned),
 * fail (a known sender failing, e.g. forwarding), unknown (failing and not a known sender: alert, 7.4).
 */
export const dmarcRecords = pgTable(
  'dmarc_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => dmarcReports.id, { onDelete: 'cascade' }),
    sourceIp: text('source_ip').notNull(),
    count: integer('count').notNull(),
    disposition: text('disposition'),
    dkim: text('dkim'),
    spf: text('spf'),
    headerFrom: text('header_from'),
    category: text('category').notNull(),
    ...timestamps,
  },
  (table) => [index('dmarc_records_report_idx').on(table.reportId), index('dmarc_records_ip_idx').on(table.sourceIp)],
);

/**
 * Events known to Marketing Hub: pushed by Event Hub (PRD 10.2, phase 4) or entered by staff while Event
 * Hub is not ready (10.5). Read by the newsletter collectors for upcoming and recent events (NWS-02).
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Event Hub ID; null for events entered by hand. */
    externalId: text('external_id').unique(),
    title: text('title').notNull(),
    /** open_day, workshop, info_session, meetup, graduation, other */
    type: text('type').notNull(),
    language: text('language'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    public: boolean('public').notNull().default(false),
    registrationUrl: text('registration_url'),
    registrationOpen: boolean('registration_open').notNull().default(false),
    recordingUrl: text('recording_url'),
    photosUrl: text('photos_url'),
    mediaPublic: boolean('media_public').notNull().default(false),
    ...timestamps,
  },
  (table) => [index('events_starts_idx').on(table.startsAt)],
);

export type EventRow = typeof events.$inferSelect;

/** Recurring newsletter schedule (NWS-01): one issue per language per period, sent to that language's segment. */
export const newsletterCadences = pgTable('newsletter_cadences', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** monthly (default) | biweekly */
  interval: text('interval').notNull().default('monthly'),
  /** Monthly: day of the month the issue goes out (1-28). */
  sendDay: integer('send_day').notNull().default(10),
  /** Hour in Yerevan time. */
  sendHour: integer('send_hour').notNull().default(11),
  /** Collect and draft this many working days before the send date (8.1: default five). */
  collectWorkingDays: integer('collect_working_days').notNull().default(5),
  languages: text('languages').array().notNull(),
  /** Segment per language, e.g. {"hy": "<segment id>"} (NWS-06). */
  segments: jsonb('segments').$type<Record<string, string>>().notNull(),
  templateId: uuid('template_id'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export type NewsletterCadenceRow = typeof newsletterCadences.$inferSelect;

/** Issue (PRD 12.2): one language version of one edition. */
export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cadenceId: uuid('cadence_id')
      .notNull()
      .references(() => newsletterCadences.id, { onDelete: 'cascade' }),
    /** e.g. 2026-12 */
    edition: text('edition').notNull(),
    language: text('language').notNull(),
    /** Items since this moment (the previous issue's cut-off) are collected. */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    cutOffAt: timestamp('cut_off_at', { withTimezone: true }),
    collectAt: timestamp('collect_at', { withTimezone: true }).notNull(),
    plannedSendAt: timestamp('planned_send_at', { withTimezone: true }).notNull(),
    /** collecting | draft | in_review | approved | scheduled | sent */
    status: text('status').notNull().default('collecting'),
    subject: text('subject'),
    preheader: text('preheader'),
    subjectAiDrafted: boolean('subject_ai_drafted').notNull().default(false),
    /** NWS-16: optional second subject tested on a sample before the full send. */
    subjectB: text('subject_b'),
    abSamplePercent: integer('ab_sample_percent').notNull().default(20),
    abWaitHours: integer('ab_wait_hours').notNull().default(4),
    sendId: uuid('send_id'),
    archiveSlug: text('archive_slug').unique(),
    ...timestamps,
  },
  (table) => [uniqueIndex('issues_edition_idx').on(table.cadenceId, table.edition, table.language)],
);

export type IssueRow = typeof issues.$inferSelect;

/**
 * CollectedItem (PRD 12.2, NWS-02): what a collector found, with a link to its source record. Shared by all
 * language versions; `payload` keeps the source fields (titles per language, dates, links).
 */
export const collectedItems = pgTable(
  'collected_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystem: text('source_system').notNull(),
    sourceRef: text('source_ref').notNull(),
    /** upcoming_event | recent_event | library | graduation | hire | new_group */
    type: text('type').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    publishable: boolean('publishable').notNull(),
    /** Why the publish rule left it out (8.5 "skipped items" panel). */
    skipReason: text('skip_reason'),
    ...timestamps,
  },
  (table) => [uniqueIndex('collected_items_source_idx').on(table.sourceSystem, table.sourceRef, table.type)],
);

export type CollectedItemRow = typeof collectedItems.$inferSelect;

/** IssueBlock (PRD 12.2): one block of an issue, in order. */
export const issueBlocks = pgTable(
  'issue_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    /** lead | upcoming_events | recent_events | library | graduations | hires | new_groups | cta | custom */
    type: text('type').notNull(),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    /** Same safe markup as campaign bodies. */
    body: text('body').notNull(),
    /** Collected item IDs shown in the block (8.1 "each block shows its source item"). */
    itemIds: uuid('item_ids').array().notNull(),
    imageUrl: text('image_url'),
    imageAlt: text('image_alt'),
    buttonLabel: text('button_label'),
    buttonUrl: text('button_url'),
    /** NWS-07: true until a person edits or accepts the text. */
    aiDrafted: boolean('ai_drafted').notNull().default(false),
    editedBy: text('edited_by'),
    ...timestamps,
  },
  (table) => [index('issue_blocks_issue_idx').on(table.issueId, table.position)],
);

export type IssueBlockRow = typeof issueBlocks.$inferSelect;

/** NWS-17: every edit to an issue with editor, time and the text before and after. */
export const issueEdits = pgTable(
  'issue_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id'),
    actorId: text('actor_id').notNull(),
    /** edit | add | remove | reorder | swap | subject | accept_ai | ai_draft */
    action: text('action').notNull(),
    field: text('field'),
    before: text('before'),
    after: text('after'),
    ...timestamps,
  },
  (table) => [index('issue_edits_issue_idx').on(table.issueId, table.createdAt)],
);

/**
 * Uploaded images for newsletters (NWS-05). Served publicly at /api/public/images/:id because email clients
 * load them without a session; size is capped so issues stay under the 1 MB image budget (NWS-09).
 */
export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentType: text('content_type').notNull(),
  bytes: text('bytes').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  ...timestamps,
});

/** Newsletter template (NWS-15): brand colours, font, logo and footer, reused across issues. */
export const newsletterTemplates = pgTable('newsletter_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  accentColor: text('accent_color').notNull(),
  buttonTextColor: text('button_text_color').notNull(),
  backgroundColor: text('background_color').notNull(),
  textColor: text('text_color').notNull(),
  fontFamily: text('font_family').notNull(),
  logoUrl: text('logo_url'),
  headerText: text('header_text').notNull(),
  footerNote: text('footer_note'),
  version: integer('version').notNull().default(1),
  createdBy: text('created_by').notNull(),
  ...timestamps,
});

export type NewsletterTemplateRow = typeof newsletterTemplates.$inferSelect;

/** Review thread of an issue (NWS-10): comments, change requests and the approval itself. */
export const issueComments = pgTable(
  'issue_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    /** comment | submitted | approved | changes_requested | unscheduled */
    kind: text('kind').notNull(),
    body: text('body'),
    ...timestamps,
  },
  (table) => [index('issue_comments_issue_idx').on(table.issueId, table.createdAt)],
);

/** Every tracked click (EML-04 "clicked" events) with its URL and newsletter block, for clicks per block (NWS-13). */
export const linkClicks = pgTable(
  'link_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    sendId: uuid('send_id').notNull(),
    contactId: uuid('contact_id'),
    url: text('url').notNull(),
    /** utm_content of the clicked link: the newsletter block ID. */
    blockId: text('block_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('link_clicks_send_idx').on(table.sendId, table.blockId)],
);

/**
 * RawRecord (PRD 12.3): API responses stored unchanged with the pull time, so clean tables can be rebuilt
 * after a logic change (9.2). Kept 13 months (12.4).
 */
export const rawRecords = pgTable(
  'raw_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** website_analytics | social_meta | meta_ads | google_ads | ads_csv:<platform> */
    source: text('source').notNull(),
    endpoint: text('endpoint').notNull(),
    windowFrom: date('window_from').notNull(),
    windowTo: date('window_to').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    pulledAt: timestamp('pulled_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('raw_records_source_idx').on(table.source, table.windowFrom), index('raw_records_pulled_idx').on(table.pulledAt)],
);

/** Website sessions and form conversions per day and campaign parameters (9.1); anonymous, channel traffic only. */
export const webTrafficDaily = pgTable(
  'web_traffic_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    utmSource: text('utm_source').notNull().default(''),
    utmMedium: text('utm_medium').notNull().default(''),
    utmCampaign: text('utm_campaign').notNull().default(''),
    landingPage: text('landing_page').notNull(),
    /** Taxonomy channel (9.3); null = unmapped, shown for review (ANL-03). */
    channel: text('channel'),
    sessions: integer('sessions').notNull(),
    conversions: integer('conversions').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('web_traffic_daily_key').on(table.date, table.utmSource, table.utmMedium, table.utmCampaign, table.landingPage),
    index('web_traffic_daily_channel_idx').on(table.channel, table.date),
  ],
);

/** Social account metrics per day (9.1). */
export const socialDaily = pgTable(
  'social_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    platform: text('platform').notNull(),
    accountId: text('account_id').notNull(),
    reach: integer('reach').notNull(),
    engagement: integer('engagement').notNull(),
    followers: integer('followers').notNull(),
    leadForms: integer('lead_forms').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('social_daily_key').on(table.platform, table.accountId, table.date)],
);

/**
 * Ad spend per platform campaign per day (9.1), from the platform API or a CSV upload. Stored in AMD at the
 * CBA rate of the spend date, keeping the original amount and currency (9.2).
 */
export const adSpendDaily = pgTable(
  'ad_spend_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    /** meta_ads | google_ads */
    platform: text('platform').notNull(),
    platformCampaignId: text('platform_campaign_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    /** Campaign key shared with touchpoints (utm_campaign). */
    campaign: text('campaign').notNull(),
    channel: text('channel').notNull(),
    amountAmd: integer('amount_amd').notNull(),
    originalAmount: text('original_amount').notNull(),
    currency: text('currency').notNull(),
    rateToAmd: text('rate_to_amd').notNull(),
    impressions: integer('impressions').notNull(),
    clicks: integer('clicks').notNull(),
    leads: integer('leads').notNull(),
    /** api | csv */
    origin: text('origin').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('ad_spend_daily_key').on(table.platform, table.platformCampaignId, table.date),
    index('ad_spend_daily_channel_idx').on(table.channel, table.date),
  ],
);

/**
 * Channel taxonomy rules (PRD 9.3, ANL-03): settings that map campaign parameters or CRM channel labels to a
 * channel. Built-in rules live in code; these are added by staff, usually when resolving an unmapped value.
 */
export const channelRules = pgTable(
  'channel_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** source_medium ("instagram/paid_social") | medium | source | crm_label */
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    channel: text('channel').notNull(),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('channel_rules_key').on(table.kind, table.value)],
);

/** UnmappedValue (PRD 12.3): the taxonomy review queue, never silently folded into "other". */
export const unmappedValues = pgTable(
  'unmapped_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    /** utm (value "source / medium") | crm_label */
    field: text('field').notNull(),
    value: text('value').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
    resolvedChannelId: text('resolved_channel_id'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('unmapped_values_key').on(table.source, table.field, table.value)],
);

/**
 * Tracked links from the campaign link builder (PRD 9.3, ANL-04): staff never type campaign parameters by
 * hand. The short link redirects to the full URL and counts clicks (anonymous traffic, not attribution).
 */
export const trackedLinks = pgTable(
  'tracked_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    label: text('label'),
    destinationUrl: text('destination_url').notNull(),
    fullUrl: text('full_url').notNull(),
    channel: text('channel').notNull(),
    utmSource: text('utm_source').notNull(),
    utmMedium: text('utm_medium').notNull(),
    utmCampaign: text('utm_campaign').notNull(),
    utmContent: text('utm_content'),
    clicks: integer('clicks').notNull().default(0),
    lastClickAt: timestamp('last_click_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('tracked_links_code').on(table.code), index('tracked_links_campaign_idx').on(table.utmCampaign)],
);

/**
 * Manual costs (PRD 9.1, ANL-05): agency fees, printed materials, sponsorships, venues. Stored in AMD at the
 * CBA rate of the first spend day, keeping the original amount; spread evenly over the date range when a
 * report covers part of it. Deleted entries are kept with who deleted them.
 */
export const manualCosts = pgTable(
  'manual_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull(),
    campaign: text('campaign'),
    description: text('description').notNull(),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to').notNull(),
    amountAmd: integer('amount_amd').notNull(),
    originalAmount: text('original_amount').notNull(),
    currency: text('currency').notNull(),
    rateToAmd: text('rate_to_amd').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
    /** Source of a cost sent by another system, e.g. "event_hub:<costId>"; a resend replaces the amount. */
    externalRef: text('external_ref').unique(),
    ...timestamps,
  },
  (table) => [index('manual_costs_dates_idx').on(table.dateFrom, table.dateTo)],
);

/** Event Hub messages already processed (EVT-02): each idempotency key once; kept as the integration log. */
export const eventHubMessages = pgTable('event_hub_messages', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  /** processed | ignored */
  status: text('status').notNull(),
  detail: text('detail'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

/**
 * Event registrations (EVT-03, EVT-05, PRD 10.5): from Event Hub, a CSV attendee list or the manual form.
 * A registration for an event not received yet keeps the Event Hub event ID and is linked when it arrives.
 */
export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Event Hub registration ID; null for CSV and manual entries. */
    externalId: text('external_id').unique(),
    eventExternalId: text('event_external_id'),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** registered | cancelled */
    status: text('status').notNull().default('registered'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    /** event_hub | csv | manual */
    source: text('source').notNull(),
    ...timestamps,
  },
  (table) => [
    index('event_registrations_event_idx').on(table.eventId),
    index('event_registrations_external_event_idx').on(table.eventExternalId),
    uniqueIndex('event_registrations_contact_event').on(table.eventId, table.contactId),
  ],
);
