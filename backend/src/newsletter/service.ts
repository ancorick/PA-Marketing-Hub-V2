import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { collectedItems, issueBlocks, issues, newsletterCadences, type IssueBlockRow, type IssueRow, type NewsletterCadenceRow } from '../db/schema.js';
import type { Language } from '../integrations/core-engine/contract.js';
import type { JobResult } from '../jobs/runner.js';
import type { CollectedItem, Collectors } from './collectors.js';
import { buildDraft, type RankingSettings } from './draft.js';

export class NewsletterError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_state' | 'invalid_field',
    message: string,
  ) {
    super(message);
    this.name = 'NewsletterError';
  }
}

export type CadenceInput = {
  name: string;
  sendDay: number;
  sendHour: number;
  collectWorkingDays: number;
  languages: Language[];
  segments: Partial<Record<Language, string>>;
  /** NWS-15: template for every issue of this cadence; none = the default brand look. */
  templateId?: string | null;
  active: boolean;
};

const YEREVAN_OFFSET_HOURS = 4;
const DAY = 86_400_000;

/** The monthly send moment: `day` of the month at `hour` Yerevan time. */
export function monthlySendAt(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month, day, hour - YEREVAN_OFFSET_HOURS));
}

/** Goes back `days` working days (Monday to Friday, Yerevan calendar). */
export function minusWorkingDays(date: Date, days: number): Date {
  let result = new Date(date);
  let left = days;
  while (left > 0) {
    result = new Date(result.getTime() - DAY);
    const weekday = new Date(result.getTime() + YEREVAN_OFFSET_HOURS * 3_600_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return result;
}

/** Subject until the editor writes one (NWS-07 can propose others). */
const DEFAULT_SUBJECT: Record<Language, (month: string) => string> = {
  en: (month) => `Picsart Academy news, ${month}`,
  hy: (month) => `Picsart Academy-ի նորությունները, ${month}`,
  ru: (month) => `Новости Picsart Academy, ${month}`,
};
const MONTH: Record<Language, string> = { en: 'en-GB', hy: 'hy-AM', ru: 'ru-RU' };

export type IssueView = Omit<IssueRow, 'periodStart' | 'cutOffAt' | 'collectAt' | 'plannedSendAt' | 'createdAt' | 'updatedAt'> & {
  periodStart: string;
  cutOffAt: string | null;
  collectAt: string;
  plannedSendAt: string;
  updatedAt: string;
};

const iso = (value: Date | null) => value?.toISOString() ?? null;
export const issueView = (row: IssueRow): IssueView => ({
  ...row,
  periodStart: row.periodStart.toISOString(),
  cutOffAt: iso(row.cutOffAt),
  collectAt: row.collectAt.toISOString(),
  plannedSendAt: row.plannedSendAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

type Deps = {
  db: AppPgDatabase;
  collectors: Collectors;
  ranking: () => Promise<RankingSettings | undefined>;
  ctaUrl: string | null;
  /** NWS-04: called when a draft is ready. */
  onDraftReady?: (issue: IssueView) => Promise<void>;
  now?: () => Date;
};

/**
 * Newsletter schedule and drafts (NWS-01, NWS-02, NWS-03, NWS-06): each cadence gets one issue per language and
 * edition; the collectors run N working days before the send date and the draft is built from ranked items.
 */
export class NewsletterService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  async cadences(): Promise<NewsletterCadenceRow[]> {
    return this.deps.db.select().from(newsletterCadences).orderBy(asc(newsletterCadences.createdAt));
  }

  async saveCadence(input: CadenceInput, id?: string): Promise<NewsletterCadenceRow> {
    if (input.sendDay < 1 || input.sendDay > 28) throw new NewsletterError('invalid_field', 'Choose a send day from 1 to 28 (every month has it)');
    if (input.languages.length === 0) throw new NewsletterError('invalid_field', 'Choose at least one language');
    const values = { ...input, interval: 'monthly', segments: input.segments as Record<string, string> };
    if (id) {
      const [row] = await this.deps.db.update(newsletterCadences).set(values).where(eq(newsletterCadences.id, id)).returning();
      if (!row) throw new NewsletterError('not_found', 'Cadence not found');
      return row;
    }
    const [row] = await this.deps.db.insert(newsletterCadences).values(values).returning();
    return row as NewsletterCadenceRow;
  }

  /** Daily job: create upcoming issues, then collect and draft those that are due. */
  async tick(): Promise<JobResult> {
    const created = await this.schedule();
    const due = await this.deps.db.select().from(issues).where(and(eq(issues.status, 'collecting'), lte(issues.collectAt, this.now())));
    for (const issue of due) await this.collectAndDraft(issue.id);
    return { rowsIn: due.length, rowsUpserted: created + due.length };
  }

  /** NWS-01: the next edition of every active cadence, one issue per language. */
  async schedule(): Promise<number> {
    const now = this.now();
    let created = 0;
    for (const cadence of (await this.cadences()).filter((item) => item.active)) {
      const yerevan = new Date(now.getTime() + YEREVAN_OFFSET_HOURS * 3_600_000);
      let planned = monthlySendAt(yerevan.getUTCFullYear(), yerevan.getUTCMonth(), cadence.sendDay, cadence.sendHour);
      if (planned <= now) planned = monthlySendAt(yerevan.getUTCFullYear(), yerevan.getUTCMonth() + 1, cadence.sendDay, cadence.sendHour);
      const edition = new Date(planned.getTime() + YEREVAN_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
      for (const language of cadence.languages) {
        const [previous] = await this.deps.db
          .select()
          .from(issues)
          .where(and(eq(issues.cadenceId, cadence.id), eq(issues.language, language)))
          .orderBy(desc(issues.plannedSendAt))
          .limit(1);
        if (previous?.edition === edition) continue;
        const inserted = await this.deps.db
          .insert(issues)
          .values({
            cadenceId: cadence.id,
            edition,
            language,
            // The first issue covers at least the last 30 days, however far away its send date is.
            periodStart: previous?.cutOffAt ?? previous?.plannedSendAt ?? new Date(Math.min(planned.getTime(), now.getTime()) - 30 * DAY),
            collectAt: minusWorkingDays(planned, cadence.collectWorkingDays),
            plannedSendAt: planned,
          })
          .onConflictDoNothing()
          .returning({ id: issues.id });
        created += inserted.length;
      }
    }
    return created;
  }

  /** Runs the collectors for the issue's period and (re)builds its draft. */
  async collectAndDraft(issueId: string): Promise<IssueView> {
    const issue = await this.require(issueId);
    if (!['collecting', 'draft'].includes(issue.status)) throw new NewsletterError('invalid_state', `A ${issue.status} issue is not redrafted`);
    const now = this.now();
    const { items } = await this.deps.collectors.collect(new Date(issue.periodStart), now, new Date(issue.plannedSendAt));
    const language = issue.language as Language;
    const blocks = buildDraft(items, language, now, { ranking: await this.deps.ranking(), ctaUrl: this.deps.ctaUrl ?? '' });
    const month = new Intl.DateTimeFormat(MONTH[language], { month: 'long', year: 'numeric', timeZone: 'Asia/Yerevan' }).format(new Date(issue.plannedSendAt));
    const updated = await this.deps.db.transaction(async (tx) => {
      await tx.delete(issueBlocks).where(eq(issueBlocks.issueId, issueId));
      if (blocks.length > 0) {
        await tx.insert(issueBlocks).values(
          blocks.map((block, position) => ({
            issueId,
            position,
            type: block.type,
            title: block.title,
            body: block.body,
            itemIds: block.itemIds,
            buttonLabel: block.buttonUrl ? block.buttonLabel : null,
            buttonUrl: block.buttonUrl || null,
          })),
        );
      }
      const [row] = await tx
        .update(issues)
        .set({ status: 'draft', cutOffAt: now, subject: issue.subject ?? DEFAULT_SUBJECT[language](month) })
        .where(eq(issues.id, issueId))
        .returning();
      return issueView(row as IssueRow);
    });
    await this.deps.onDraftReady?.(updated);
    return updated;
  }

  async list(): Promise<IssueView[]> {
    return (await this.deps.db.select().from(issues).orderBy(desc(issues.plannedSendAt), asc(issues.language))).map(issueView);
  }

  async require(id: string): Promise<IssueView> {
    const [row] = await this.deps.db.select().from(issues).where(eq(issues.id, id));
    if (!row) throw new NewsletterError('not_found', 'Issue not found');
    return issueView(row);
  }

  async blocks(issueId: string): Promise<IssueBlockRow[]> {
    return this.deps.db.select().from(issueBlocks).where(eq(issueBlocks.issueId, issueId)).orderBy(asc(issueBlocks.position));
  }

  /** Items collected for the issue's period: used in blocks, available to swap in, or skipped with a reason (8.5). */
  async items(issue: IssueView): Promise<CollectedItem[]> {
    const from = new Date(issue.periodStart);
    const to = new Date(new Date(issue.plannedSendAt).getTime() + 75 * DAY);
    return (await this.deps.db
      .select()
      .from(collectedItems)
      .where(and(gte(collectedItems.occurredAt, from), lte(collectedItems.occurredAt, to)))
      .orderBy(desc(collectedItems.occurredAt))) as CollectedItem[];
  }

  async itemsByIds(ids: string[]): Promise<CollectedItem[]> {
    return ids.length === 0 ? [] : ((await this.deps.db.select().from(collectedItems).where(inArray(collectedItems.id, ids))) as CollectedItem[]);
  }
}
