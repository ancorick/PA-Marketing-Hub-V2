import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, contacts, deliveries, outcomes, sends } from '../db/schema.js';
import { MODEL_LABEL, STAGES, UNATTRIBUTED, UNMAPPED, type AttributionModel, type AttributionService, type Stage } from './attribution.js';
import type { CostService } from './costs.js';
import type { DateRange } from './sources/contract.js';

/** A count of people, or the small-number marker in views shared outside marketing (ANL-14, NFR-P5). */
export type Count = number | 'fewer_than_3';
export const FEWER_THAN_3 = 'fewer_than_3' as const;

/** Metric definitions (PRD 9.5) shown next to every number (ANL-15, story ANL-S3). */
export const DEFINITIONS = {
  subscribers: 'Contacts whose latest newsletter consent is granted and who can be emailed (not unsubscribed, bounced, complained or erased), now.',
  newsletterClickRate: 'Unique clickers divided by delivered newsletter emails, for issues sent in the period. Opens are estimates and are not used.',
  newLeads: 'People who first expressed interest in a course in the period (CRM stage lead or later).',
  enrolledFromLeads: 'Of the new leads in the period, those whose record has since become an active student in the Core Engine.',
  lead: 'A contact who first expressed interest in a course in the period (CRM stage lead or later).',
  applied: 'A lead who submitted an application.',
  enrolled: 'An applicant whose record became an active student in the Core Engine.',
  completed: 'An enrolled student who finished the course (graduated).',
  hired: 'A graduate with employment status employed in Alumni Tracker. Any job counts until PRD 16.3 question 6 is answered.',
  channelCost: 'Ad spend plus manual costs allocated to the channel in the period, in AMD. Cash costs only.',
  costPerLead: 'Channel cost in the period divided by the leads credited to the channel.',
  costPerEnrolled: 'Channel cost in the period divided by the enrolled students credited to the channel.',
  costPerHired: 'Channel cost divided by the hired graduates credited to the channel. Final only for cohorts at least 12 months old.',
  unmapped: 'Touches whose campaign parameters or CRM label no taxonomy rule maps yet (see Channel taxonomy).',
  unattributed: 'People with no recorded touch in the 365 days before the anchor date: tracking gaps and word of mouth.',
} as const;

export type OverviewRow = {
  channel: ChannelId | typeof UNMAPPED | typeof UNATTRIBUTED;
  lead: Count;
  applied: Count;
  enrolled: Count;
  hired: Count;
  costAmd: number;
  costPerLead: number | null;
  costPerEnrolled: number | null;
};

export type Overview = {
  period: DateRange;
  previous: DateRange;
  model: AttributionModel;
  modelLabel: string;
  /** True for roles outside marketing: counts of 1 or 2 people are hidden (ANL-14). */
  shared: boolean;
  tiles: {
    subscribers: Count;
    newsletterClickRate: { rate: number | null; delivered: number; previousRate: number | null };
    newLeads: { value: Count; previous: Count };
    enrolledFromLeads: { value: Count; previous: Count };
  };
  channels: OverviewRow[];
  totals: Omit<OverviewRow, 'channel'>;
  definitions: typeof DEFINITIONS;
};

const DAY = 86_400_000;
const yerevanStart = (day: string) => new Date(`${day}T00:00:00+04:00`);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The period of the same length just before (for tile deltas). */
export function previousPeriod(range: DateRange): DateRange {
  const length = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY) + 1;
  return { from: shift(range.from, -length), to: shift(range.from, -1) };
}

/** Hides 1 or 2 people when shared outside marketing; fractional credit below 3 counts as small too. */
export const suppress = (value: number, shared: boolean): Count => (shared && value > 0 && value < 3 ? FEWER_THAN_3 : value);

const ratio = (cost: number, count: number) => (count > 0 ? Math.round(cost / count) : null);

/**
 * The Overview view (PRD 9.6, ANL-08): headline tiles and the channel table with leads, enrolled, hired and
 * cost per student for any period up to 24 months, under one attribution model.
 */
export class OverviewService {
  constructor(
    private readonly deps: { db: AppPgDatabase; attribution: AttributionService; costs: CostService },
  ) {}

  async overview(range: DateRange, model: AttributionModel, shared: boolean): Promise<Overview> {
    const previous = previousPeriod(range);
    const [rows, costs, subscribers, clicks, previousClicks, leads, previousLeads] = await Promise.all([
      this.deps.attribution.byChannel(range, model),
      this.deps.costs.channelCosts(range),
      this.subscribers(),
      this.clickRate(range),
      this.clickRate(previous),
      this.leadsAndEnrolled(range),
      this.leadsAndEnrolled(previous),
    ]);
    const channelKeys = [...costs.map((cost) => cost.channel as OverviewRow['channel']), UNMAPPED, UNATTRIBUTED] as OverviewRow['channel'][];
    const raw = channelKeys.map((channel) => {
      const credited = rows.find((row) => row.channel === channel);
      const costAmd = costs.find((cost) => cost.channel === channel)?.totalAmd ?? 0;
      const counts = Object.fromEntries(STAGES.map((stage) => [stage, credited?.[stage] ?? 0])) as Record<Stage, number>;
      return { channel, counts, costAmd };
    });
    const view = (counts: Record<Stage, number>, costAmd: number) => {
      const small = (value: number) => suppress(value, shared) === FEWER_THAN_3;
      return {
        lead: suppress(counts.lead, shared),
        applied: suppress(counts.applied, shared),
        enrolled: suppress(counts.enrolled, shared),
        hired: suppress(counts.hired, shared),
        costAmd,
        // A cost per person over 1 or 2 people would reveal the count.
        costPerLead: small(counts.lead) ? null : ratio(costAmd, counts.lead),
        costPerEnrolled: small(counts.enrolled) ? null : ratio(costAmd, counts.enrolled),
      };
    };
    const sum = (stage: Stage) => Math.round(raw.reduce((total, row) => total + row.counts[stage], 0) * 100) / 100;
    const totalCounts = Object.fromEntries(STAGES.map((stage) => [stage, sum(stage)])) as Record<Stage, number>;
    return {
      period: range,
      previous,
      model,
      modelLabel: MODEL_LABEL[model],
      shared,
      tiles: {
        subscribers: suppress(subscribers, shared),
        newsletterClickRate: { rate: shared && clicks.clicks > 0 && clicks.clicks < 3 ? null : clicks.rate, delivered: clicks.delivered, previousRate: previousClicks.rate },
        newLeads: { value: suppress(leads.leads, shared), previous: suppress(previousLeads.leads, shared) },
        enrolledFromLeads: { value: suppress(leads.enrolled, shared), previous: suppress(previousLeads.enrolled, shared) },
      },
      channels: raw.map((row) => ({ channel: row.channel, ...view(row.counts, row.costAmd) })),
      totals: view(totalCounts, raw.reduce((total, row) => total + row.costAmd, 0)),
      definitions: DEFINITIONS,
    };
  }

  /** Contacts behind one number (ANL-15), with their share of the credit; at most 500 listed. */
  async people(range: DateRange, model: AttributionModel, stage: Stage, channel: string, campaign?: string) {
    const credited = await this.deps.attribution.contactsBehind(range, model, stage, channel, campaign);
    const shares = new Map(credited.map((item) => [item.contactId, item.share]));
    const ids = credited.slice(0, 500).map((item) => item.contactId);
    const rows = ids.length
      ? await this.deps.db
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, type: contacts.type, status: contacts.status })
          .from(contacts)
          .where(inArray(contacts.id, ids))
      : [];
    return {
      total: credited.length,
      people: rows.map((row) => ({ ...row, share: shares.get(row.id) ?? 0 })).sort((a, b) => b.share - a.share || (a.email ?? '').localeCompare(b.email ?? '')),
    };
  }

  private async subscribers(): Promise<number> {
    const latest = sql`(select ${consentRecords.state} from ${consentRecords} where ${consentRecords.contactId} = ${contacts.id} and ${consentRecords.topic} = 'newsletter' order by ${consentRecords.createdAt} desc limit 1)`;
    const [row] = await this.deps.db
      .select({ n: sql<number>`count(*)` })
      .from(contacts)
      .where(and(eq(contacts.status, 'active'), sql`${latest} = 'granted'`));
    return Number(row?.n ?? 0);
  }

  private async clickRate(range: DateRange) {
    const [row] = await this.deps.db
      .select({
        delivered: sql<number>`count(*) filter (where ${deliveries.status} in ('sent', 'delivered'))`,
        clicks: sql<number>`count(${deliveries.firstClickAt})`,
      })
      .from(deliveries)
      .innerJoin(sends, eq(deliveries.sendId, sends.id))
      .where(and(isNotNull(sends.issueId), gte(sends.finishedAt, yerevanStart(range.from)), lt(sends.finishedAt, new Date(yerevanStart(range.to).getTime() + DAY))));
    const delivered = Number(row?.delivered ?? 0);
    const clicks = Number(row?.clicks ?? 0);
    return { delivered, clicks, rate: delivered > 0 ? clicks / delivered : null };
  }

  private async leadsAndEnrolled(range: DateRange) {
    const leadRows = await this.deps.db
      .selectDistinct({ contactId: outcomes.contactId })
      .from(outcomes)
      .where(and(eq(outcomes.type, 'lead'), isNotNull(outcomes.contactId), gte(outcomes.occurredAt, yerevanStart(range.from)), lt(outcomes.occurredAt, new Date(yerevanStart(range.to).getTime() + DAY))));
    const ids = leadRows.map((row) => row.contactId as string);
    if (ids.length === 0) return { leads: 0, enrolled: 0 };
    const enrolled = await this.deps.db
      .selectDistinct({ contactId: outcomes.contactId })
      .from(outcomes)
      .where(and(eq(outcomes.type, 'enrolled'), inArray(outcomes.contactId, ids)));
    return { leads: ids.length, enrolled: enrolled.length };
  }
}
