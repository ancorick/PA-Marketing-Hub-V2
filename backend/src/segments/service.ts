import { and, asc, count, desc, eq, inArray, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import type { Topic } from '../consent/wordings.js';
import type { Contact } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, contactImports, contacts, segmentMembers, segments, type SegmentRow } from '../db/schema.js';
import { ACTIVE_ADMISSION_STAGES } from '../sync/service.js';
import { compileRule, ruleSchema, type RuleGroup } from './rules.js';

export class SegmentError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'SegmentError';
  }
}

export type SegmentType = 'dynamic' | 'static';

export type SegmentView = {
  id: string;
  name: string;
  description: string | null;
  type: SegmentType;
  rule: RuleGroup | null;
  ownerId: string;
  lastCount: number | null;
  lastCountedAt: string | null;
  updatedAt: string;
};

export type AudienceOptions = {
  /** Only contacts whose latest consent for this topic is granted (6.3 rule 1). */
  topic?: Topic;
  /** AUD-17: on by default for recruitment campaigns; the editor can include them on purpose. */
  excludeActiveAdmissions?: boolean;
};

/** Why people in a segment will or will not receive a send (Flow B step 5), shown before sending. */
export type AudienceBreakdown = {
  matching: number;
  notReachable: number;
  noConsent: number;
  activeAdmissions: number;
  eligible: number;
};

const view = (row: SegmentRow): SegmentView => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type as SegmentType,
  rule: (row.rule as RuleGroup | null) ?? null,
  ownerId: row.ownerId,
  lastCount: row.lastCount,
  lastCountedAt: row.lastCountedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Segments (AUD-13 to AUD-15, AUD-17). Dynamic membership is recalculated from the rule whenever it is
 * asked for (live count while editing, the audience at send time, AUD-14); static lists hold members.
 */
export class SegmentService {
  private readonly now: () => Date;

  constructor(
    private readonly db: AppPgDatabase,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  parseRule(input: unknown): RuleGroup {
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success) throw new SegmentError('rule', parsed.error.issues[0]?.message ?? 'Invalid rule');
    return parsed.data;
  }

  async list(): Promise<SegmentView[]> {
    return (await this.db.select().from(segments).orderBy(desc(segments.updatedAt))).map(view);
  }

  async get(id: string): Promise<SegmentView | null> {
    const [row] = await this.db.select().from(segments).where(eq(segments.id, id));
    return row ? view(row) : null;
  }

  async create(input: { name: string; description?: string | null; type: SegmentType; rule?: unknown }, ownerId: string): Promise<SegmentView> {
    const rule = input.type === 'dynamic' ? this.parseRule(input.rule) : null;
    const [row] = await this.db
      .insert(segments)
      .values({ name: input.name.trim(), description: input.description ?? null, type: input.type, rule, ownerId })
      .returning();
    return this.refreshCount((row as SegmentRow).id);
  }

  async update(id: string, input: { name?: string; description?: string | null; rule?: unknown }): Promise<SegmentView | null> {
    const current = await this.get(id);
    if (!current) return null;
    const rule = input.rule !== undefined && current.type === 'dynamic' ? this.parseRule(input.rule) : undefined;
    await this.db
      .update(segments)
      .set({
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.description !== undefined && { description: input.description }),
        ...(rule !== undefined && { rule }),
      })
      .where(eq(segments.id, id));
    return this.refreshCount(id);
  }

  async remove(id: string): Promise<boolean> {
    return (await this.db.delete(segments).where(eq(segments.id, id)).returning({ id: segments.id })).length > 0;
  }

  /** Live count while editing (AUD-14, NFR-F2): the rule is evaluated now, never cached. */
  async countRule(input: unknown): Promise<number> {
    const where = compileRule(this.parseRule(input), this.now());
    const [row] = await this.db.select({ value: count() }).from(contacts).where(where);
    return row?.value ?? 0;
  }

  async previewRule(input: unknown, limit = 20): Promise<Contact[]> {
    const where = compileRule(this.parseRule(input), this.now());
    return (await this.db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(limit)) as Contact[];
  }

  /** Members of a segment now: its rule, or its static member list. */
  private async membership(segment: SegmentView): Promise<SQL> {
    if (segment.type === 'dynamic') return compileRule(segment.rule as RuleGroup, this.now());
    return sql`${contacts.id} in (select ${segmentMembers.contactId} from ${segmentMembers} where ${segmentMembers.segmentId} = ${segment.id})`;
  }

  async members(segmentId: string, page: { limit: number; offset: number }): Promise<{ contacts: Contact[]; total: number } | null> {
    const segment = await this.get(segmentId);
    if (!segment) return null;
    const where = await this.membership(segment);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(contacts).where(where).orderBy(asc(contacts.email)).limit(page.limit).offset(page.offset),
      this.db.select({ value: count() }).from(contacts).where(where),
    ]);
    return { contacts: rows as Contact[], total: total?.value ?? 0 };
  }

  /** Static lists (AUD-15): add by contact ID or by email; unknown emails are reported back. */
  async addMembers(segmentId: string, input: { contactIds?: string[]; emails?: string[] }, actorId: string): Promise<{ added: number; notFound: string[] }> {
    const segment = await this.get(segmentId);
    if (!segment) throw new SegmentError('segmentId', 'Segment not found');
    if (segment.type !== 'static') throw new SegmentError('type', 'Only static lists have hand-picked members');
    const emails = [...new Set((input.emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    const byEmail = emails.length > 0 ? await this.db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(inArray(contacts.email, emails)) : [];
    const ids = [...new Set([...(input.contactIds ?? []), ...byEmail.map((row) => row.id)])];
    const notFound = emails.filter((email) => !byEmail.some((row) => row.email === email));
    if (ids.length === 0) return { added: 0, notFound };
    const known = await this.db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
    const inserted = await this.db
      .insert(segmentMembers)
      .values(known.map((row) => ({ segmentId, contactId: row.id, addedBy: actorId })))
      .onConflictDoNothing()
      .returning({ id: segmentMembers.contactId });
    await this.refreshCount(segmentId);
    return { added: inserted.length, notFound };
  }

  async removeMembers(segmentId: string, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) return 0;
    const removed = await this.db
      .delete(segmentMembers)
      .where(and(eq(segmentMembers.segmentId, segmentId), inArray(segmentMembers.contactId, contactIds)))
      .returning({ id: segmentMembers.contactId });
    await this.refreshCount(segmentId);
    return removed.length;
  }

  /** Conditions every marketing recipient must meet, on top of segment membership. */
  private reachability(options: AudienceOptions): { reachable: SQL; consent: SQL | undefined; admissions: SQL | undefined } {
    const consent = options.topic
      ? sql`(select ${consentRecords.state} from ${consentRecords} where ${consentRecords.contactId} = ${contacts.id} and ${consentRecords.topic} = ${options.topic} order by ${consentRecords.createdAt} desc limit 1) = 'granted'`
      : undefined;
    return {
      // Status mirrors the suppression list (AUD-12); the send pipeline checks the list itself again per message.
      reachable: and(
        eq(contacts.status, 'active'),
        isNotNull(contacts.email),
        // EML-15: contacts moved out of regular sends by the sunset policy.
        isNull(contacts.sunsetAt),
        // 7.4: contacts of an import blocked for its bounce rate wait until someone reviews it.
        sql`not exists (select 1 from ${contactImports} where ${contactImports.id} = ${contacts.importId} and ${contactImports.sendBlockedAt} is not null and ${contactImports.reviewedAt} is null)`,
      ) as SQL,
      consent,
      admissions: options.excludeActiveAdmissions ? (or(isNull(contacts.crmStage), not(inArray(contacts.crmStage, ACTIVE_ADMISSION_STAGES))) as SQL) : undefined,
    };
  }

  /** The send audience, recalculated at call time (AUD-14, Flow B step 5). */
  async audienceWhere(segmentId: string, options: AudienceOptions): Promise<SQL | null> {
    const segment = await this.get(segmentId);
    if (!segment) return null;
    const { reachable, consent, admissions } = this.reachability(options);
    return and(await this.membership(segment), reachable, consent, admissions) as SQL;
  }

  async audience(segmentId: string, options: AudienceOptions): Promise<Contact[]> {
    const where = await this.audienceWhere(segmentId, options);
    if (!where) return [];
    return (await this.db.select().from(contacts).where(where).orderBy(asc(contacts.id))) as Contact[];
  }

  async breakdown(segmentId: string, options: AudienceOptions): Promise<AudienceBreakdown | null> {
    const segment = await this.get(segmentId);
    if (!segment) return null;
    const members = await this.membership(segment);
    const { reachable, consent, admissions } = this.reachability(options);
    const countWhere = async (where: SQL | undefined) => (await this.db.select({ value: count() }).from(contacts).where(where))[0]?.value ?? 0;
    const matching = await countWhere(members);
    const reachableCount = await countWhere(and(members, reachable));
    const withConsent = await countWhere(and(members, reachable, consent));
    const eligible = await countWhere(and(members, reachable, consent, admissions));
    return { matching, notReachable: matching - reachableCount, noConsent: reachableCount - withConsent, activeAdmissions: withConsent - eligible, eligible };
  }

  private async refreshCount(id: string): Promise<SegmentView> {
    const segment = (await this.get(id)) as SegmentView;
    const where = await this.membership(segment);
    const [row] = await this.db.select({ value: count() }).from(contacts).where(where);
    const [updated] = await this.db
      .update(segments)
      .set({ lastCount: row?.value ?? 0, lastCountedAt: this.now() })
      .where(eq(segments.id, id))
      .returning();
    return view(updated as SegmentRow);
  }
}
