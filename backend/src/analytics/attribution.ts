import { and, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, outcomes, touchpoints } from '../db/schema.js';
import type { DateRange } from './sources/contract.js';

/** PRD 9.4: two Must models side by side, position-based as Should; results never mix models. */
export const ATTRIBUTION_MODELS = ['first_touch', 'last_touch', 'position_based'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export const MODEL_LABEL: Record<AttributionModel, string> = {
  first_touch: 'First touch',
  last_touch: 'Last touch (before application)',
  position_based: 'Position-based (40/20/40)',
};

/** Outcome stages counted per channel (9.5). */
export const STAGES = ['lead', 'applied', 'enrolled', 'completed', 'hired'] as const;
export type Stage = (typeof STAGES)[number];

/** Touches with a channel nothing maps (ANL-03) and people with no recorded touch at all (R6) stay visible. */
export const UNMAPPED = 'unmapped';
export const UNATTRIBUTED = 'unattributed';

const LOOKBACK_MS = 365 * 86_400_000;
const DAY = 86_400_000;

export type Touch = { channel: string | null; campaign: string | null; at: Date };
export type Credit = { channel: string; campaign: string | null; share: number };
export type StageCounts = Record<Stage, number>;
export type AttributionRow = { key: string; channel: string } & StageCounts;

const zero = (): StageCounts => ({ lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 });

/**
 * Credit for one person's touches (sorted oldest first), by model. First touch: all to the first; last touch:
 * all to the last; position-based: 40% first, 40% last, 20% split across the middle (one touch takes 100%,
 * two touches 50/50).
 */
export function credit(touches: Touch[], model: AttributionModel): Credit[] {
  if (touches.length === 0) return [{ channel: UNATTRIBUTED, campaign: null, share: 1 }];
  const toCredit = (touch: Touch, share: number): Credit => ({ channel: touch.channel ?? UNMAPPED, campaign: touch.campaign, share });
  const first = touches[0] as Touch;
  const last = touches[touches.length - 1] as Touch;
  if (model === 'first_touch') return [toCredit(first, 1)];
  if (model === 'last_touch') return [toCredit(last, 1)];
  if (touches.length === 1) return [toCredit(first, 1)];
  if (touches.length === 2) return [toCredit(first, 0.5), toCredit(last, 0.5)];
  const middle = touches.slice(1, -1);
  return [toCredit(first, 0.4), ...middle.map((touch) => toCredit(touch, 0.2 / middle.length)), toCredit(last, 0.4)];
}

/** Touches that count for attribution: inside 365 days before the anchor; estimated opens never count (7.5). */
export function window(touches: Touch[], anchor: Date): Touch[] {
  return touches.filter((touch) => touch.at <= anchor && touch.at.getTime() >= anchor.getTime() - LOOKBACK_MS).sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type Person = { touches: Touch[]; appliedAt: Date | null; enrolledAt: Date | null; firstTouchAt: Date | null };

/**
 * The date touches are counted up to: the application (9.4, last touch before application); a person enrolled
 * without a recorded application uses the enrollment; otherwise the outcome itself.
 */
export function anchorFor(person: Pick<Person, 'appliedAt' | 'enrolledAt'>, outcomeAt: Date): Date {
  const conversion = person.appliedAt ?? person.enrolledAt;
  return conversion && conversion <= outcomeAt ? conversion : outcomeAt;
}

/**
 * Attribution (PRD 9.4, ANL-06, ANL-07) of the leads, applicants, enrolled students, graduates and hired
 * graduates whose outcome falls in the period (period view). The anchor is the application date (last touch
 * before application); people who never applied use the outcome date. The lookback is 365 days.
 */
export class AttributionService {
  constructor(private readonly db: AppPgDatabase) {}

  async byChannel(range: DateRange, model: AttributionModel): Promise<AttributionRow[]> {
    return this.aggregate(range, model, (c) => c.channel);
  }

  async byCampaign(range: DateRange, model: AttributionModel, channel?: string): Promise<AttributionRow[]> {
    return this.aggregate(range, model, (c) => (channel && c.channel !== channel ? null : (c.campaign ?? '(no campaign)')));
  }

  /** Credits for one person under every model (contact page, ANL-06). */
  async forContact(contactId: string): Promise<{ anchor: string | null; models: Record<AttributionModel, Credit[]> }> {
    const people = await this.people([contactId]);
    const person = people.get(contactId) ?? { touches: [], appliedAt: null, enrolledAt: null, firstTouchAt: null };
    const anchor = anchorFor(person, new Date());
    const touches = window(person.touches, anchor);
    return {
      anchor: (person.appliedAt ?? person.enrolledAt)?.toISOString() ?? null,
      models: Object.fromEntries(ATTRIBUTION_MODELS.map((model) => [model, credit(touches, model)])) as Record<AttributionModel, Credit[]>,
    };
  }

  /** People with an outcome in the period: each counted once per stage, at their first outcome of that stage. */
  async outcomesIn(range: DateRange): Promise<{ contactId: string | null; type: Stage; at: Date }[]> {
    const start = new Date(`${range.from}T00:00:00+04:00`);
    const end = new Date(new Date(`${range.to}T00:00:00+04:00`).getTime() + DAY);
    const rows = await this.db
      .select({ contactId: outcomes.contactId, type: outcomes.type, at: sql<Date>`min(${outcomes.occurredAt})` })
      .from(outcomes)
      .where(and(gte(outcomes.occurredAt, start), lt(outcomes.occurredAt, end), inArray(outcomes.type, [...STAGES])))
      // People not linked to a contact are told apart by their Core Engine ID or source reference.
      .groupBy(outcomes.contactId, outcomes.type, sql`case when ${outcomes.contactId} is null then coalesce(${outcomes.corePersonId}, ${outcomes.sourceRef}) end`);
    return rows.map((row) => ({ contactId: row.contactId, type: row.type as Stage, at: new Date(row.at) }));
  }

  /** Visits every credit of every outcome in the period. */
  async walk(range: DateRange, model: AttributionModel, visit: (outcome: { contactId: string | null; type: Stage; at: Date }, credit: Credit) => void) {
    const rows = await this.outcomesIn(range);
    const people = await this.people([...new Set(rows.map((row) => row.contactId).filter((id): id is string => id !== null))]);
    for (const row of rows) {
      const person = row.contactId ? people.get(row.contactId) : undefined;
      const credits = person ? credit(window(person.touches, anchorFor(person, row.at)), model) : [{ channel: UNATTRIBUTED, campaign: null, share: 1 }];
      for (const item of credits) visit(row, item);
    }
  }

  private async aggregate(range: DateRange, model: AttributionModel, keyOf: (credit: Credit) => string | null): Promise<AttributionRow[]> {
    const totals = new Map<string, AttributionRow>();
    await this.walk(range, model, (row, item) => {
      const key = keyOf(item);
      if (key === null) return;
      const total = totals.get(key) ?? { key, channel: item.channel, ...zero() };
      total[row.type] += item.share;
      totals.set(key, total);
    });
    // Shares are exact to the hundredth; reports round for display.
    return [...totals.values()].map((row) => ({ ...row, ...Object.fromEntries(STAGES.map((stage) => [stage, Math.round(row[stage] * 100) / 100])) }) as AttributionRow);
  }

  /** The people behind one number (ANL-15): contacts credited for a stage in a channel (and campaign), with their share. */
  async contactsBehind(range: DateRange, model: AttributionModel, stage: Stage, channel: string, campaign?: string): Promise<{ contactId: string; share: number }[]> {
    const shares = new Map<string, number>();
    await this.walk(range, model, (row, item) => {
      if (row.type !== stage || !row.contactId || item.channel !== channel) return;
      if (campaign !== undefined && (item.campaign ?? '(no campaign)') !== campaign) return;
      shares.set(row.contactId, (shares.get(row.contactId) ?? 0) + item.share);
    });
    return [...shares].map(([contactId, share]) => ({ contactId, share: Math.round(share * 100) / 100 }));
  }

  /** Touches (without estimated opens), the first application date and the source of each contact. */
  async people(contactIds: string[]): Promise<Map<string, Person>> {
    const people = new Map<string, Person>();
    for (let i = 0; i < contactIds.length; i += 1000) {
      const ids = contactIds.slice(i, i + 1000);
      const [touchRows, applied, sources] = await Promise.all([
        this.db
          .select({ contactId: touchpoints.contactId, channel: touchpoints.channel, campaign: touchpoints.campaign, at: touchpoints.occurredAt })
          .from(touchpoints)
          .where(and(inArray(touchpoints.contactId, ids), ne(touchpoints.type, 'open'))),
        this.db
          .select({ contactId: outcomes.contactId, type: outcomes.type, at: sql<Date>`min(${outcomes.occurredAt})` })
          .from(outcomes)
          .where(and(inArray(outcomes.contactId, ids), inArray(outcomes.type, ['applied', 'enrolled'])))
          .groupBy(outcomes.contactId, outcomes.type),
        this.db
          .select({ id: contacts.id, channel: contacts.sourceChannel, campaign: contacts.sourceCampaign, at: contacts.firstTouchAt })
          .from(contacts)
          .where(inArray(contacts.id, ids)),
      ]);
      for (const id of ids) people.set(id, { touches: [], appliedAt: null, enrolledAt: null, firstTouchAt: null });
      for (const row of touchRows) people.get(row.contactId as string)?.touches.push({ channel: row.channel, campaign: row.campaign, at: row.at });
      for (const row of applied) {
        const person = people.get(row.contactId as string);
        if (person && row.type === 'applied') person.appliedAt = new Date(row.at);
        if (person && row.type === 'enrolled') person.enrolledAt = new Date(row.at);
      }
      for (const row of sources) {
        const person = people.get(row.id);
        if (!person) continue;
        person.firstTouchAt = row.at;
        // The recorded source (CRM lead source, import) is the first touch when no touch was recorded by then.
        if (row.channel && !person.touches.some((touch) => touch.at.getTime() <= row.at.getTime() + 60_000)) {
          person.touches.push({ channel: row.channel, campaign: row.campaign, at: row.at });
        }
      }
    }
    return people;
  }
}
