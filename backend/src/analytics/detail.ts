import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { adSpendDaily, contacts, outcomes } from '../db/schema.js';
import { anchorFor, credit, MODEL_LABEL, STAGES, window, type AttributionModel, type AttributionService, type Stage } from './attribution.js';
import type { CostService } from './costs.js';
import { FEWER_THAN_3, suppress, type Count } from './overview.js';
import type { DateRange } from './sources/contract.js';

const DAY = 86_400_000;
const YEREVAN = 4 * 3_600_000;
const NO_CAMPAIGN = '(no campaign)';

type Counts = Record<Stage, Count>;
const monthOf = (at: Date) => new Date(at.getTime() + YEREVAN).toISOString().slice(0, 7);
const monthRange = (month: string): DateRange => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const per = (cost: number, count: number) => (count > 0 ? Math.round(cost / count) : null);
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Channel, campaign and cohort views (PRD 9.6, ANL-09) and the maturing rule for cost per hired graduate
 * (9.5, ANL-10). Counts follow the chosen attribution model; small numbers are hidden outside marketing.
 */
export class DetailService {
  constructor(private readonly deps: { db: AppPgDatabase; attribution: AttributionService; costs: CostService; now?: () => Date }) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private counts(values: Record<Stage, number>, shared: boolean): Counts {
    return Object.fromEntries(STAGES.map((stage) => [stage, suppress(round(values[stage]), shared)])) as Counts;
  }

  private costPer(cost: number, value: number, shared: boolean) {
    return suppress(value, shared) === FEWER_THAN_3 ? null : per(cost, value);
  }

  /** Funnel lead → hired, campaigns inside the channel and the 12 months up to the period end. */
  async channel(channel: string, range: DateRange, model: AttributionModel, shared: boolean) {
    const trendFrom = `${addMonths(range.to.slice(0, 7), -11)}-01`;
    const funnel = { lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
    const months = new Map<string, Record<Stage, number>>();
    await this.deps.attribution.walk({ from: trendFrom < range.from ? trendFrom : range.from, to: range.to }, model, (outcome, item) => {
      if (item.channel !== channel) return;
      const day = new Date(outcome.at.getTime() + YEREVAN).toISOString().slice(0, 10);
      if (day >= range.from && day <= range.to) funnel[outcome.type] += item.share;
      if (day >= trendFrom) {
        const month = day.slice(0, 7);
        const bucket = months.get(month) ?? { lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
        bucket[outcome.type] += item.share;
        months.set(month, bucket);
      }
    });
    const cost = (await this.deps.costs.channelCosts(range)).find((row) => row.channel === channel)?.totalAmd ?? 0;
    const trend = await Promise.all(
      Array.from({ length: 12 }, (_, i) => addMonths(trendFrom.slice(0, 7), i)).map(async (month) => {
        const values = months.get(month) ?? { lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
        const monthCost = (await this.deps.costs.channelCosts(monthRange(month))).find((row) => row.channel === channel)?.totalAmd ?? 0;
        return { month, ...this.counts(values, shared), costAmd: monthCost };
      }),
    );
    const campaigns = await this.campaigns(range, model, shared, channel);
    return {
      channel,
      period: range,
      model,
      modelLabel: MODEL_LABEL[model],
      shared,
      funnel: this.counts(funnel, shared),
      costAmd: cost,
      costPerLead: this.costPer(cost, funnel.lead, shared),
      costPerEnrolled: this.costPer(cost, funnel.enrolled, shared),
      campaigns,
      trend,
    };
  }

  /** Campaigns with outcomes or cost in the period (optionally inside one channel). */
  async campaigns(range: DateRange, model: AttributionModel, shared: boolean, channel?: string) {
    const rows = await this.deps.attribution.byCampaign(range, model, channel);
    const costs = await this.deps.costs.campaignCosts(range);
    const keys = new Set([...rows.map((row) => row.key), ...(channel ? [] : [...costs.keys()])]);
    if (channel) {
      // Ad spend and manual costs of campaigns that ran in this channel.
      const inChannel = await this.deps.db
        .selectDistinct({ campaign: adSpendDaily.campaign })
        .from(adSpendDaily)
        .where(and(eq(adSpendDaily.channel, channel), gte(adSpendDaily.date, range.from), lte(adSpendDaily.date, range.to)));
      for (const row of inChannel) keys.add(row.campaign);
    }
    return [...keys].map((key) => {
      const row = rows.find((item) => item.key === key);
      const values = { lead: row?.lead ?? 0, applied: row?.applied ?? 0, enrolled: row?.enrolled ?? 0, completed: row?.completed ?? 0, hired: row?.hired ?? 0 };
      const costAmd = key === NO_CAMPAIGN ? 0 : (costs.get(key) ?? 0);
      return { campaign: key, ...this.counts(values, shared), costAmd, costPerLead: this.costPer(costAmd, values.lead, shared), costPerEnrolled: this.costPer(costAmd, values.enrolled, shared) };
    });
  }

  /** Spend, results reported by the ad platforms, and credited outcomes with cost per outcome for one campaign. */
  async campaign(key: string, range: DateRange, model: AttributionModel, shared: boolean) {
    const values = { lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
    const channels = new Map<string, number>();
    await this.deps.attribution.walk(range, model, (outcome, item) => {
      if ((item.campaign ?? NO_CAMPAIGN) !== key) return;
      values[outcome.type] += item.share;
      channels.set(item.channel, (channels.get(item.channel) ?? 0) + item.share);
    });
    const costAmd = key === NO_CAMPAIGN ? 0 : ((await this.deps.costs.campaignCosts(range)).get(key) ?? 0);
    const [ads] = await this.deps.db
      .select({
        spend: sql<number>`coalesce(sum(${adSpendDaily.amountAmd}), 0)`,
        impressions: sql<number>`coalesce(sum(${adSpendDaily.impressions}), 0)`,
        clicks: sql<number>`coalesce(sum(${adSpendDaily.clicks}), 0)`,
        platformLeads: sql<number>`coalesce(sum(${adSpendDaily.leads}), 0)`,
      })
      .from(adSpendDaily)
      .where(and(eq(adSpendDaily.campaign, key), gte(adSpendDaily.date, range.from), lte(adSpendDaily.date, range.to)));
    return {
      campaign: key,
      period: range,
      model,
      modelLabel: MODEL_LABEL[model],
      shared,
      costAmd,
      adSpendAmd: Number(ads?.spend ?? 0),
      impressions: Number(ads?.impressions ?? 0),
      clicks: Number(ads?.clicks ?? 0),
      platformLeads: Number(ads?.platformLeads ?? 0),
      ...this.counts(values, shared),
      costPerLead: this.costPer(costAmd, values.lead, shared),
      costPerApplicant: this.costPer(costAmd, values.applied, shared),
      costPerEnrolled: this.costPer(costAmd, values.enrolled, shared),
      channels: [...channels.keys()],
    };
  }

  /**
   * Cohorts (9.5): people grouped by the month of their first touch, with everything that happened to them
   * since. Cost is the channel cost in that month. Cost per hired graduate appears only once a cohort is at
   * least 12 months old; younger cohorts are labelled maturing (ANL-10).
   */
  async cohorts(model: AttributionModel, shared: boolean, channel?: string, monthsBack = 24) {
    const current = monthOf(this.now());
    const first = addMonths(current, -(monthsBack - 1));
    const people = await this.deps.db
      .select({ id: contacts.id, firstTouchAt: contacts.firstTouchAt })
      .from(contacts)
      .where(and(gte(contacts.firstTouchAt, new Date(new Date(`${first}-01T00:00:00Z`).getTime() - YEREVAN))));
    const ids = people.map((person) => person.id);
    const stagesOf = new Map<string, Set<Stage>>();
    const lastOutcome = new Map<string, Date>();
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await this.deps.db
        .select({ contactId: outcomes.contactId, type: outcomes.type, at: sql<Date>`max(${outcomes.occurredAt})` })
        .from(outcomes)
        .where(and(inArray(outcomes.contactId, ids.slice(i, i + 1000)), inArray(outcomes.type, [...STAGES])))
        .groupBy(outcomes.contactId, outcomes.type);
      for (const row of rows) {
        const id = row.contactId as string;
        const set = stagesOf.get(id) ?? new Set<Stage>();
        set.add(row.type as Stage);
        stagesOf.set(id, set);
        const day = new Date(row.at);
        if (!lastOutcome.has(id) || day > (lastOutcome.get(id) as Date)) lastOutcome.set(id, day);
      }
    }
    const profiles = channel ? await this.deps.attribution.people(ids) : null;
    const buckets = new Map<string, Record<Stage | 'people', number>>();
    for (const person of people) {
      let share = 1;
      if (profiles && channel) {
        const profile = profiles.get(person.id);
        // Same anchor as the period view, measured at the person's latest outcome (or first touch).
        const anchor = anchorFor(profile ?? { appliedAt: null, enrolledAt: null }, lastOutcome.get(person.id) ?? person.firstTouchAt);
        const credits = credit(window(profile?.touches ?? [], anchor), model);
        share = credits.filter((item) => item.channel === channel).reduce((sum, item) => sum + item.share, 0);
        if (share === 0) continue;
      }
      const month = monthOf(person.firstTouchAt);
      const bucket = buckets.get(month) ?? { people: 0, lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
      bucket.people += share;
      for (const stage of stagesOf.get(person.id) ?? []) bucket[stage] += share;
      buckets.set(month, bucket);
    }
    const today = this.now();
    const rows = await Promise.all(
      Array.from({ length: monthsBack }, (_, i) => addMonths(first, i)).map(async (month) => {
        const values = buckets.get(month) ?? { people: 0, lead: 0, applied: 0, enrolled: 0, completed: 0, hired: 0 };
        const costs = await this.deps.costs.channelCosts(monthRange(month));
        const costAmd = channel ? (costs.find((row) => row.channel === channel)?.totalAmd ?? 0) : costs.reduce((sum, row) => sum + row.totalAmd, 0);
        const end = new Date(`${monthRange(month).to}T23:59:59+04:00`);
        const ageMonths = (today.getTime() - end.getTime()) / (30.44 * DAY);
        const maturing = ageMonths < 12;
        return {
          month,
          maturing,
          people: suppress(round(values.people), shared),
          ...this.counts(values, shared),
          costAmd,
          costPerEnrolled: this.costPer(costAmd, values.enrolled, shared),
          // Hiring lags enrollment by a year or more: never a final number before 12 months (ANL-10).
          costPerHired: maturing ? null : this.costPer(costAmd, values.hired, shared),
          // For a maturing cohort, the cost per hired graduate so far, shown as provisional ("so far").
          costPerHiredSoFar: maturing ? this.costPer(costAmd, values.hired, shared) : null,
        };
      }),
    );
    return { model, modelLabel: MODEL_LABEL[model], channel: channel ?? null, shared, cohorts: rows.reverse() };
  }
}
