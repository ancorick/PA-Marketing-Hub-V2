import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { ConsentService } from '../consent/service.js';
import { CHANNEL_IDS, normalizeName, normalizePhone, type ChannelId, type ContactType } from '../contacts/fields.js';
import { channelFromUtm } from '../contacts/channels.js';
import type { Contact, ContactRepository } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, outcomes, touchpoints } from '../db/schema.js';
import type { AlumniTrackerClient } from '../integrations/alumni-tracker/contract.js';
import type { CoreEngineClient, CorePerson } from '../integrations/core-engine/contract.js';
import type { CrmLead, CrmStage, NavigatorCrmClient } from '../integrations/navigator-crm/contract.js';
import type { JobDefinition, JobResult } from '../jobs/runner.js';

/** CRM stages where the person is talking to admissions (AUD-17: kept out of generic recruitment campaigns). */
export const ACTIVE_ADMISSION_STAGES: CrmStage[] = ['contacted', 'applied', 'interview', 'accepted'];

const STAGE_TYPE: Record<CrmStage, ContactType> = {
  new: 'lead',
  contacted: 'lead',
  applied: 'applicant',
  interview: 'applicant',
  accepted: 'applicant',
  // The Core Engine turns them into students; until it does they stay applicants.
  enrolled: 'applicant',
  rejected: 'lead',
  lost: 'lead',
};

const EPOCH = new Date(0);
const MINUTE = 60_000;

/** CRM channel labels → taxonomy; null = unmapped, shown for review in phase 3 (ANL-03). */
function channelFromLabel(label: string | null): ChannelId | null {
  if (!label) return null;
  const value = label.trim().toLowerCase();
  if ((CHANNEL_IDS as string[]).includes(value)) return value as ChannelId;
  if (value === 'website' || value === 'web' || value === 'site') return 'search_website';
  const mapped = channelFromUtm(value, value);
  return mapped === 'search_website' ? null : mapped;
}

type SyncDeps = {
  db: AppPgDatabase;
  contacts: Pick<ContactRepository, 'findByEmail' | 'findByCorePersonId' | 'insert' | 'update'>;
  consent: Pick<ConsentService, 'statusForEmail'>;
  coreEngine: Pick<CoreEngineClient, 'listPeopleChangedSince' | 'listOutcomesSince' | 'addMarketingTouches'>;
  crm: Pick<NavigatorCrmClient, 'listLeadsChangedSince' | 'listStageChangesSince'>;
  alumni: Pick<AlumniTrackerClient, 'listEmploymentChangedSince' | 'listReferralsSince'>;
};

/**
 * Two-way sync with the Core Engine and Navigator CRM, plus Alumni Tracker reads (AUD-06, PRD 11.1).
 * Each job pulls a time window with overlap and upserts by source ID (9.2), so re-runs never double-count.
 * Marketing Hub mirrors people and lifecycle; it writes back marketing touches (and CRM leads at sign-up).
 */
export class SyncService {
  constructor(private readonly deps: SyncDeps) {}

  jobs(): JobDefinition[] {
    const every = (minutes: number) => minutes * MINUTE;
    return [
      { name: 'core_people', description: 'Core Engine people: link, create and update contacts', intervalMs: every(15), overlapMs: every(60), run: ({ windowFrom }) => this.syncPeople(windowFrom ?? EPOCH) },
      { name: 'core_outcomes', description: 'Core Engine enrollments and completions', intervalMs: every(15), overlapMs: every(60), run: ({ windowFrom }) => this.syncCoreOutcomes(windowFrom ?? EPOCH) },
      { name: 'crm_leads', description: 'Navigator CRM leads and stages', intervalMs: every(15), overlapMs: every(60), run: ({ windowFrom }) => this.syncLeads(windowFrom ?? EPOCH) },
      { name: 'crm_stage_changes', description: 'Navigator CRM applications', intervalMs: every(15), overlapMs: every(60), run: ({ windowFrom }) => this.syncStageChanges(windowFrom ?? EPOCH) },
      { name: 'alumni_employment', description: 'Alumni Tracker employment', intervalMs: every(60), overlapMs: every(120), run: ({ windowFrom }) => this.syncEmployment(windowFrom ?? EPOCH) },
      { name: 'alumni_referrals', description: 'Alumni Tracker referrals as referral touchpoints', intervalMs: every(60), overlapMs: every(120), run: ({ windowFrom }) => this.syncReferrals(windowFrom ?? EPOCH) },
      { name: 'core_touches_push', description: 'Marketing touches written to Core Engine person records', intervalMs: every(15), overlapMs: every(60), run: ({ windowFrom, windowTo }) => this.pushTouches(windowFrom ?? EPOCH, windowTo) },
    ];
  }

  async syncPeople(since: Date): Promise<JobResult> {
    const people = await this.deps.coreEngine.listPeopleChangedSince(since);
    let upserted = 0;
    for (const person of people) if (await this.upsertPerson(person)) upserted += 1;
    return { rowsIn: people.length, rowsUpserted: upserted };
  }

  async syncCoreOutcomes(since: Date): Promise<JobResult> {
    const rows = await this.deps.coreEngine.listOutcomesSince(since);
    let upserted = 0;
    for (const outcome of rows) {
      const contact = await this.deps.contacts.findByCorePersonId(outcome.personId);
      upserted += await this.upsertOutcome({
        contactId: contact?.id ?? null,
        corePersonId: outcome.personId,
        type: outcome.type,
        occurredAt: new Date(outcome.occurredAt),
        courseId: outcome.courseId,
        groupId: outcome.groupId ?? null,
        sourceSystem: 'core_engine',
        sourceRef: outcome.id,
      });
    }
    return { rowsIn: rows.length, rowsUpserted: upserted };
  }

  async syncLeads(since: Date): Promise<JobResult> {
    const leads = await this.deps.crm.listLeadsChangedSince(since);
    let upserted = 0;
    for (const lead of leads) {
      const contact = await this.upsertLead(lead);
      if (!contact) continue;
      upserted += 1;
      await this.upsertOutcome({
        contactId: contact.id,
        corePersonId: lead.corePersonId,
        type: 'lead',
        occurredAt: new Date(lead.createdAt),
        courseId: lead.courseInterest,
        groupId: null,
        sourceSystem: 'navigator_crm',
        sourceRef: lead.id,
      });
    }
    return { rowsIn: leads.length, rowsUpserted: upserted };
  }

  async syncStageChanges(since: Date): Promise<JobResult> {
    const changes = await this.deps.crm.listStageChangesSince(since);
    let upserted = 0;
    for (const change of changes.filter((item) => item.toStage === 'applied')) {
      const [contact] = await this.deps.db.select().from(contacts).where(eq(contacts.crmLeadId, change.leadId));
      upserted += await this.upsertOutcome({
        contactId: contact?.id ?? null,
        corePersonId: contact?.corePersonId ?? null,
        type: 'applied',
        occurredAt: new Date(change.occurredAt),
        courseId: null,
        groupId: null,
        sourceSystem: 'navigator_crm',
        sourceRef: change.leadId,
      });
    }
    return { rowsIn: changes.length, rowsUpserted: upserted };
  }

  async syncEmployment(since: Date): Promise<JobResult> {
    const records = await this.deps.alumni.listEmploymentChangedSince(since);
    let upserted = 0;
    for (const record of records) {
      const contact = await this.deps.contacts.findByCorePersonId(record.corePersonId);
      if (contact && contact.employmentStatus !== record.status) {
        await this.deps.contacts.update(contact.id, { employmentStatus: record.status }, 'sync:alumni_tracker');
        upserted += 1;
      }
      // "Hired" = employed, any job, until PRD 16.3 question 6 decides whether only tech roles count.
      if (record.status === 'employed') {
        upserted += await this.upsertOutcome({
          contactId: contact?.id ?? null,
          corePersonId: record.corePersonId,
          type: 'hired',
          occurredAt: new Date(record.startDate ? `${record.startDate}T00:00:00+04:00` : record.updatedAt),
          courseId: null,
          groupId: null,
          sourceSystem: 'alumni_tracker',
          sourceRef: `${record.corePersonId}:${record.startDate ?? record.updatedAt}`,
        });
      }
    }
    return { rowsIn: records.length, rowsUpserted: upserted };
  }

  /**
   * Referrals (12.1 touchpoint type "referral"): stored on the referrer, with the referred email as the
   * source reference, so the "referral champions" segment (6.4) can check whether they enrolled.
   */
  async syncReferrals(since: Date): Promise<JobResult> {
    const referrals = await this.deps.alumni.listReferralsSince(since);
    let upserted = 0;
    for (const referral of referrals) {
      const referrer = await this.deps.contacts.findByCorePersonId(referral.referrerPersonId);
      if (!referrer) continue;
      const ref = referral.referredEmail.trim().toLowerCase();
      const [existing] = await this.deps.db
        .select({ id: touchpoints.id })
        .from(touchpoints)
        .where(and(eq(touchpoints.sourceSystem, 'alumni_tracker'), eq(touchpoints.sourceRef, ref), eq(touchpoints.type, 'referral')));
      if (existing) continue;
      await this.deps.db.insert(touchpoints).values({
        contactId: referrer.id,
        channel: 'referrals',
        campaign: null,
        type: 'referral',
        occurredAt: new Date(referral.occurredAt),
        sourceSystem: 'alumni_tracker',
        sourceRef: ref,
      });
      upserted += 1;
    }
    return { rowsIn: referrals.length, rowsUpserted: upserted };
  }

  /** Writes touches of linked contacts to the Core Engine person record (idempotent by touch ID). */
  async pushTouches(from: Date, to: Date): Promise<JobResult> {
    const rows = await this.deps.db
      .select({ touch: touchpoints, personId: contacts.corePersonId })
      .from(touchpoints)
      .innerJoin(contacts, eq(touchpoints.contactId, contacts.id))
      .where(and(isNotNull(contacts.corePersonId), gte(touchpoints.createdAt, from), lte(touchpoints.createdAt, to)));
    for (let i = 0; i < rows.length; i += 200) {
      await this.deps.coreEngine.addMarketingTouches(
        rows.slice(i, i + 200).map(({ touch, personId }) => ({
          id: touch.id,
          personId: personId as string,
          type: touch.type,
          channel: touch.channel,
          campaign: touch.campaign,
          occurredAt: touch.occurredAt.toISOString(),
        })),
      );
    }
    return { rowsIn: rows.length, rowsUpserted: rows.length };
  }

  private async upsertPerson(person: CorePerson): Promise<boolean> {
    const email = person.email.trim().toLowerCase();
    const contact = (await this.deps.contacts.findByCorePersonId(person.id)) ?? (await this.deps.contacts.findByEmail(email));
    const actor = 'sync:core_engine';
    if (!contact) {
      await this.deps.contacts.insert(
        {
          corePersonId: person.id,
          email,
          firstName: normalizeName(person.firstName),
          lastName: normalizeName(person.lastName),
          phone: safePhone(person.phone),
          language: person.language,
          type: person.lifecycleStatus,
          // Unknown marketing source: the first touch comes later from touchpoints and the CRM.
          sourceChannel: null,
          sourceCampaign: null,
          firstTouchAt: new Date(person.updatedAt),
          tags: [],
          status: await this.deps.consent.statusForEmail(email),
        },
        actor,
      );
      return true;
    }
    if (contact.corePersonId && contact.corePersonId !== person.id) return false;
    const changes = {
      ...(contact.corePersonId === null && { corePersonId: person.id }),
      ...(contact.type !== person.lifecycleStatus && { type: person.lifecycleStatus }),
      ...(!contact.firstName && person.firstName && { firstName: normalizeName(person.firstName) }),
      ...(!contact.lastName && person.lastName && { lastName: normalizeName(person.lastName) }),
      ...(!contact.phone && safePhone(person.phone) && { phone: safePhone(person.phone) }),
    };
    if (Object.keys(changes).length === 0) return false;
    await this.deps.contacts.update(contact.id, changes, actor);
    return true;
  }

  private async upsertLead(lead: CrmLead): Promise<Contact | null> {
    const email = lead.email.trim().toLowerCase();
    const [byLead] = (await this.deps.db.select().from(contacts).where(eq(contacts.crmLeadId, lead.id))) as Contact[];
    const contact =
      byLead ??
      (lead.corePersonId ? await this.deps.contacts.findByCorePersonId(lead.corePersonId) : null) ??
      (await this.deps.contacts.findByEmail(email));
    const actor = 'sync:navigator_crm';
    const crmFields = { crmLeadId: lead.id, crmStage: lead.stage, selfReportedSource: lead.selfReportedSource };
    if (!contact) {
      const created = await this.deps.contacts.insert(
        {
          corePersonId: lead.corePersonId,
          email,
          firstName: normalizeName(lead.firstName),
          lastName: normalizeName(lead.lastName),
          phone: safePhone(lead.phone),
          language: 'hy',
          type: STAGE_TYPE[lead.stage],
          sourceChannel: channelFromLabel(lead.sourceChannel),
          sourceCampaign: lead.sourceCampaign,
          firstTouchAt: new Date(lead.createdAt),
          tags: [],
          status: await this.deps.consent.statusForEmail(email),
        },
        actor,
      );
      return (await this.deps.contacts.update(created.id, crmFields, actor)) ?? created;
    }
    const changes = {
      ...(contact.crmLeadId !== lead.id && { crmLeadId: lead.id }),
      ...(contact.crmStage !== lead.stage && { crmStage: lead.stage }),
      ...(contact.selfReportedSource !== lead.selfReportedSource && { selfReportedSource: lead.selfReportedSource }),
      // A Core Engine link decides the type; otherwise the CRM stage does.
      ...(!contact.corePersonId && contact.type !== STAGE_TYPE[lead.stage] && { type: STAGE_TYPE[lead.stage] }),
      ...(!contact.sourceChannel && channelFromLabel(lead.sourceChannel) && { sourceChannel: channelFromLabel(lead.sourceChannel) }),
      ...(new Date(lead.createdAt) < contact.firstTouchAt && { firstTouchAt: new Date(lead.createdAt) }),
    };
    if (Object.keys(changes).length === 0) return contact;
    return (await this.deps.contacts.update(contact.id, changes, actor)) ?? contact;
  }

  private async upsertOutcome(row: typeof outcomes.$inferInsert): Promise<number> {
    const inserted = await this.deps.db
      .insert(outcomes)
      .values(row)
      .onConflictDoUpdate({
        target: [outcomes.sourceSystem, outcomes.sourceRef, outcomes.type],
        set: { contactId: row.contactId ?? null, occurredAt: row.occurredAt, courseId: row.courseId ?? null, groupId: row.groupId ?? null },
      })
      .returning({ id: outcomes.id });
    return inserted.length;
  }
}

function safePhone(phone: string | null): string | null {
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}
