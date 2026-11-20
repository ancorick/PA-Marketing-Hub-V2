import { and, asc, desc, eq } from 'drizzle-orm';
import { hashEmail } from '../contacts/fields.js';
import type { Contact } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import {
  auditEvents,
  consentRecords,
  contacts,
  deliveries,
  exportLog,
  outcomes,
  segmentMembers,
  sends,
  suppressions,
  touchpoints,
} from '../db/schema.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import type { SegmentService } from '../segments/service.js';

export class PrivacyError extends Error {
  constructor(
    readonly code: 'not_found' | 'erased',
    message: string,
  ) {
    super(message);
    this.name = 'PrivacyError';
  }
}

export type TimelineItem = {
  at: string;
  kind: 'lifecycle' | 'consent' | 'email' | 'touch' | 'outcome' | 'record';
  title: string;
  detail: string | null;
};

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(';') : String(value);
  // Leading = + - @ would run as formulas in spreadsheets (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const EXPORT_COLUMNS = ['email', 'firstName', 'lastName', 'phone', 'language', 'type', 'sourceChannel', 'sourceCampaign', 'firstTouchAt', 'tags', 'status'] as const;

type Deps = {
  db: AppPgDatabase;
  segments: SegmentService;
  coreEngine: Pick<CoreEngineClient, 'writeActivityLog'>;
  logger: { error: (obj: object, msg: string) => void };
  now?: () => Date;
};

/**
 * Contact history and privacy: timeline (AUD-16), erasure (AUD-18), access export (NFR-P4) and logged
 * segment exports (AUD-19). Exports and erasures go to the Core Engine activity log (PRD 4.3, NFR-S8).
 */
export class PrivacyService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** AUD-16: consent changes, emails received, opens and clicks, events attended, lifecycle changes. */
  async timeline(contactId: string): Promise<TimelineItem[] | null> {
    const [contact] = (await this.deps.db.select().from(contacts).where(eq(contacts.id, contactId))) as Contact[];
    if (!contact) return null;
    const [audit, consent, mail, touches, results] = await Promise.all([
      this.deps.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'contact'), eq(auditEvents.entityId, contactId))),
      this.deps.db.select().from(consentRecords).where(eq(consentRecords.contactId, contactId)),
      this.deps.db.select({ delivery: deliveries, name: sends.name }).from(deliveries).innerJoin(sends, eq(sends.id, deliveries.sendId)).where(eq(deliveries.contactId, contactId)),
      this.deps.db.select().from(touchpoints).where(eq(touchpoints.contactId, contactId)),
      this.deps.db.select().from(outcomes).where(eq(outcomes.contactId, contactId)),
    ]);
    const items: TimelineItem[] = [];
    for (const row of audit) {
      // Lifecycle = a later change of type or status, not the values set when the record was created.
      const lifecycle = row.action === 'contact.updated' && (row.fields.includes('type') || row.fields.includes('status'));
      items.push({
        at: row.createdAt.toISOString(),
        kind: lifecycle ? 'lifecycle' : 'record',
        title: { 'contact.created': 'Added', 'contact.imported': 'Imported', 'contact.merged': 'Merged with a duplicate', 'contact.erased': 'Erased' }[row.action] ?? (lifecycle ? 'Lifecycle or status changed' : 'Record edited'),
        detail: row.fields.length > 0 ? `${row.fields.join(', ')} by ${row.actorId}` : `by ${row.actorId}`,
      });
    }
    for (const row of consent) {
      items.push({ at: row.createdAt.toISOString(), kind: 'consent', title: `Consent ${row.state}: ${row.topic}`, detail: [row.method, row.reason].filter(Boolean).join(' · ') || null });
    }
    for (const { delivery, name } of mail) {
      if (delivery.sentAt) items.push({ at: delivery.sentAt.toISOString(), kind: 'email', title: `Email: ${name}`, detail: delivery.status });
      if (delivery.openedAt) items.push({ at: delivery.openedAt.toISOString(), kind: 'email', title: `Opened (estimated): ${name}`, detail: null });
      if (delivery.firstClickAt) items.push({ at: delivery.firstClickAt.toISOString(), kind: 'email', title: `Clicked: ${name}`, detail: null });
    }
    for (const row of touches.filter((touch) => touch.sourceSystem !== 'esp')) {
      items.push({ at: row.occurredAt.toISOString(), kind: 'touch', title: `Touch: ${row.type}`, detail: [row.channel, row.campaign].filter(Boolean).join(' · ') || null });
    }
    for (const row of results) items.push({ at: row.occurredAt.toISOString(), kind: 'outcome', title: `Outcome: ${row.type}`, detail: row.courseId });
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * AUD-18: erase personal data, keep an anonymized row for aggregate analytics (type, language, source,
   * first touch, outcomes and touchpoints without personal fields) and keep the email hash in suppression.
   */
  async erase(contactId: string, actorId: string, reason: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      const [contact] = (await tx.select().from(contacts).where(eq(contacts.id, contactId)).for('update')) as Contact[];
      if (!contact) throw new PrivacyError('not_found', 'Contact not found');
      if (contact.status === 'erased') throw new PrivacyError('erased', 'This contact is already erased');
      if (contact.email) await tx.insert(suppressions).values({ emailHash: hashEmail(contact.email), reason: 'erased', source: 'erasure' });
      await tx
        .update(contacts)
        .set({
          email: null,
          emailKey: null,
          phone: null,
          firstName: null,
          lastName: null,
          corePersonId: null,
          crmLeadId: null,
          selfReportedSource: null,
          tags: [],
          status: 'erased',
        })
        .where(eq(contacts.id, contactId));
      await tx.update(consentRecords).set({ ip: null, sourceUrl: null }).where(eq(consentRecords.contactId, contactId));
      await tx.update(deliveries).set({ email: null }).where(eq(deliveries.contactId, contactId));
      await tx.update(outcomes).set({ corePersonId: null }).where(eq(outcomes.contactId, contactId));
      await tx.delete(segmentMembers).where(eq(segmentMembers.contactId, contactId));
      await tx.insert(auditEvents).values({ entityType: 'contact', entityId: contactId, action: 'contact.erased', actorId, fields: ['email', 'phone', 'firstName', 'lastName', 'corePersonId', 'tags'] });
    });
    await this.log({ actorId, action: 'contact.erased', subjectType: 'contact', subjectId: contactId, reason });
  }

  /** NFR-P4: everything Marketing Hub holds about one person, for an access request. Logged. */
  async exportContact(contactId: string, actorId: string) {
    const [contact] = (await this.deps.db.select().from(contacts).where(eq(contacts.id, contactId))) as Contact[];
    if (!contact) throw new PrivacyError('not_found', 'Contact not found');
    const [consent, mail, touches, results, audit] = await Promise.all([
      this.deps.db.select().from(consentRecords).where(eq(consentRecords.contactId, contactId)).orderBy(asc(consentRecords.createdAt)),
      this.deps.db
        .select({ campaign: sends.name, status: deliveries.status, sentAt: deliveries.sentAt, openedAt: deliveries.openedAt, firstClickAt: deliveries.firstClickAt })
        .from(deliveries)
        .innerJoin(sends, eq(sends.id, deliveries.sendId))
        .where(eq(deliveries.contactId, contactId)),
      this.deps.db.select().from(touchpoints).where(eq(touchpoints.contactId, contactId)).orderBy(asc(touchpoints.occurredAt)),
      this.deps.db.select().from(outcomes).where(eq(outcomes.contactId, contactId)),
      this.deps.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'contact'), eq(auditEvents.entityId, contactId))).orderBy(asc(auditEvents.createdAt)),
    ]);
    const suppression = contact.email
      ? await this.deps.db.select({ reason: suppressions.reason, since: suppressions.createdAt, liftedAt: suppressions.liftedAt }).from(suppressions).where(eq(suppressions.emailHash, hashEmail(contact.email)))
      : [];
    await this.recordExport({ actorId, kind: 'contact_data', contactId, rowCount: 1 });
    return {
      exportedAt: this.now().toISOString(),
      contact: {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        language: contact.language,
        type: contact.type,
        status: contact.status,
        frequency: contact.frequency,
        sourceChannel: contact.sourceChannel,
        sourceCampaign: contact.sourceCampaign,
        firstTouchAt: contact.firstTouchAt,
        tags: contact.tags,
        corePersonId: contact.corePersonId,
        createdAt: contact.createdAt,
      },
      consent: consent.map(({ topic, state, method, wordingVersion, sourceUrl, ip, reason, createdAt }) => ({ topic, state, method, wordingVersion, sourceUrl, ip, reason, at: createdAt })),
      suppression,
      emails: mail,
      touchpoints: touches.map(({ type, channel, campaign, occurredAt, sourceSystem }) => ({ type, channel, campaign, occurredAt, sourceSystem })),
      outcomes: results.map(({ type, occurredAt, courseId }) => ({ type, occurredAt, courseId })),
      changes: audit.map(({ action, actorId: by, fields, createdAt }) => ({ action, by, fields, at: createdAt })),
    };
  }

  /** AUD-19: segment members as CSV, with the export logged. */
  async exportSegment(segmentId: string, actorId: string): Promise<{ csv: string; rows: number; name: string } | null> {
    const segment = await this.deps.segments.get(segmentId);
    if (!segment) return null;
    const members: Contact[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.deps.segments.members(segmentId, { limit: 100, offset });
      if (!page || page.contacts.length === 0) break;
      members.push(...page.contacts);
      if (page.contacts.length < 100) break;
    }
    const lines = [EXPORT_COLUMNS.join(','), ...members.map((member) => EXPORT_COLUMNS.map((column) => csvCell(member[column])).join(','))];
    await this.recordExport({ actorId, kind: 'segment_csv', segmentId, segmentName: segment.name, rowCount: members.length });
    return { csv: `﻿${lines.join('\r\n')}\r\n`, rows: members.length, name: segment.name };
  }

  async exports(limit = 100) {
    return this.deps.db.select().from(exportLog).orderBy(desc(exportLog.createdAt)).limit(limit);
  }

  private async recordExport(entry: { actorId: string; kind: 'segment_csv' | 'contact_data'; segmentId?: string; segmentName?: string; contactId?: string; rowCount: number }) {
    await this.deps.db.insert(exportLog).values({
      actorId: entry.actorId,
      kind: entry.kind,
      segmentId: entry.segmentId ?? null,
      segmentName: entry.segmentName ?? null,
      contactId: entry.contactId ?? null,
      rowCount: entry.rowCount,
    });
    await this.log({
      actorId: entry.actorId,
      action: 'contacts.exported',
      subjectType: entry.segmentId ? 'segment' : 'contact',
      subjectId: entry.segmentId ?? entry.contactId ?? '',
      metadata: { kind: entry.kind, rows: entry.rowCount },
    });
  }

  private async log(entry: { actorId: string; action: string; subjectType: string; subjectId: string; reason?: string; metadata?: Record<string, unknown> }) {
    const full = { ...entry, occurredAt: this.now().toISOString() };
    try {
      await this.deps.coreEngine.writeActivityLog(full);
    } catch (error) {
      this.deps.logger.error({ err: error, activity: full }, 'activity log write failed');
    }
  }
}
