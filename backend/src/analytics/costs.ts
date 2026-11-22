import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { CHANNEL_IDS, type ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { adSpendDaily, manualCosts } from '../db/schema.js';
import { slug } from './links.js';
import type { DateRange, ExchangeRateClient } from './sources/contract.js';

export const COST_CURRENCIES = ['AMD', 'USD', 'EUR', 'RUB', 'GBP'] as const;

export type ManualCost = {
  id: string;
  channel: ChannelId;
  campaign: string | null;
  description: string;
  dateFrom: string;
  dateTo: string;
  amountAmd: number;
  originalAmount: string;
  currency: string;
  rateToAmd: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
};

export type CostInput = { channel: string; campaign?: string | null; description: string; dateFrom: string; dateTo: string; amount: number; currency: string };

/** Channel cost for a period (9.5): ad spend plus manual costs allocated to the days inside the period. */
export type ChannelCost = { channel: ChannelId; adSpendAmd: number; manualAmd: number; totalAmd: number };

/** One row of the Costs table: ad spend of one campaign on one day, or a manual or Event Hub cost. */
export type CostEntry = {
  id: string;
  dateFrom: string;
  dateTo: string;
  channel: ChannelId;
  campaign: string | null;
  /** Ad platform and campaign name for ad spend rows. */
  campaignName: string | null;
  amountAmd: number;
  originalAmount: string;
  currency: string;
  rateToAmd: number;
  /** api = ad platform API, csv = ad report upload, manual = entered here, event_hub = sent by Event Hub. */
  source: 'api' | 'csv' | 'manual' | 'event_hub';
  note: string;
  /** Set for manual costs that can be edited or deleted here. */
  manualId: string | null;
};

const PLATFORM_LABEL: Record<string, string> = { meta_ads: 'Meta Ads', google_ads: 'Google Ads' };
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export class CostError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

/** Share of a cost that falls inside a period, by days (a cost of 1–31 March in a report for 1–15 March counts 15/31). */
export function allocated(cost: { dateFrom: string; dateTo: string; amountAmd: number }, range: DateRange): number {
  const from = cost.dateFrom > range.from ? cost.dateFrom : range.from;
  const to = cost.dateTo < range.to ? cost.dateTo : range.to;
  if (from > to) return 0;
  return (cost.amountAmd * days(from, to)) / days(cost.dateFrom, cost.dateTo);
}

/** Manual cost entry (ANL-05) and channel costs per period (9.5). Cash costs only until PRD 16.3 question 8 is answered. */
export class CostService {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly rates: ExchangeRateClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CostInput, actor: string): Promise<ManualCost> {
    const values = await this.validate(input);
    const [row] = await this.db.insert(manualCosts).values({ ...values, createdBy: actor, updatedBy: actor }).returning();
    return view(row!);
  }

  /**
   * A cost sent by another system (Event Hub, EVT-02): created on first sight, replaced when the same reference
   * arrives again. The campaign key is kept as given.
   */
  async upsertExternal(ref: string, input: CostInput, actor: string): Promise<ManualCost> {
    const values = { ...(await this.validate({ ...input, campaign: null })), campaign: input.campaign ?? null };
    const [row] = await this.db
      .insert(manualCosts)
      .values({ ...values, externalRef: ref, createdBy: actor, updatedBy: actor })
      .onConflictDoUpdate({ target: manualCosts.externalRef, set: { ...values, updatedBy: actor, deletedAt: null, deletedBy: null } })
      .returning();
    return view(row!);
  }

  async update(id: string, input: CostInput, actor: string): Promise<ManualCost | null> {
    const values = await this.validate(input);
    const [row] = await this.db
      .update(manualCosts)
      .set({ ...values, updatedBy: actor })
      .where(and(eq(manualCosts.id, id), isNull(manualCosts.deletedAt)))
      .returning();
    return row ? view(row) : null;
  }

  async remove(id: string, actor: string): Promise<boolean> {
    const rows = await this.db
      .update(manualCosts)
      .set({ deletedAt: this.now(), deletedBy: actor, updatedBy: actor })
      .where(and(eq(manualCosts.id, id), isNull(manualCosts.deletedAt)))
      .returning({ id: manualCosts.id });
    return rows.length > 0;
  }

  /** Entries that overlap the period. */
  async list(range: DateRange): Promise<ManualCost[]> {
    const rows = await this.db
      .select()
      .from(manualCosts)
      .where(and(isNull(manualCosts.deletedAt), lte(manualCosts.dateFrom, range.to), gte(manualCosts.dateTo, range.from)))
      .orderBy(manualCosts.dateFrom, manualCosts.createdAt);
    return rows.map(view);
  }

  /** Ad spend plus allocated manual costs per channel (and campaign, when asked) for the period. */
  async channelCosts(range: DateRange): Promise<ChannelCost[]> {
    const ads = await this.db
      .select({ channel: adSpendDaily.channel, amount: sql<string>`sum(${adSpendDaily.amountAmd})` })
      .from(adSpendDaily)
      .where(and(gte(adSpendDaily.date, range.from), lte(adSpendDaily.date, range.to)))
      .groupBy(adSpendDaily.channel);
    const manual = await this.list(range);
    return CHANNEL_IDS.map((channel) => {
      const adSpendAmd = Number(ads.find((row) => row.channel === channel)?.amount ?? 0);
      const manualAmd = Math.round(manual.filter((cost) => cost.channel === channel).reduce((sum, cost) => sum + allocated(cost, range), 0));
      return { channel, adSpendAmd, manualAmd, totalAmd: adSpendAmd + manualAmd };
    });
  }

  /** Cost per campaign in the period (ad spend by utm_campaign plus manual costs naming the campaign). */
  async campaignCosts(range: DateRange): Promise<Map<string, number>> {
    const ads = await this.db
      .select({ campaign: adSpendDaily.campaign, amount: sql<string>`sum(${adSpendDaily.amountAmd})` })
      .from(adSpendDaily)
      .where(and(gte(adSpendDaily.date, range.from), lte(adSpendDaily.date, range.to)))
      .groupBy(adSpendDaily.campaign);
    const totals = new Map<string, number>(ads.map((row) => [row.campaign, Number(row.amount)]));
    for (const cost of await this.list(range)) {
      if (cost.campaign) totals.set(cost.campaign, (totals.get(cost.campaign) ?? 0) + allocated(cost, range));
    }
    for (const [key, value] of totals) totals.set(key, Math.round(value));
    return totals;
  }

  /**
   * Every cost entry that overlaps the period, newest first (RESTRUCTURE R3, Costs table): ad spend per campaign
   * and day from the platform APIs or CSV exports, manual costs, and costs sent by Event Hub.
   */
  async entries(range: DateRange): Promise<CostEntry[]> {
    const [ads, manual] = await Promise.all([
      this.db
        .select()
        .from(adSpendDaily)
        .where(and(gte(adSpendDaily.date, range.from), lte(adSpendDaily.date, range.to))),
      this.list(range),
    ]);
    const external = await this.db
      .select({ id: manualCosts.id, ref: manualCosts.externalRef })
      .from(manualCosts)
      .where(and(isNull(manualCosts.deletedAt), lte(manualCosts.dateFrom, range.to), gte(manualCosts.dateTo, range.from)));
    const refs = new Map(external.map((row) => [row.id, row.ref]));
    const entries: CostEntry[] = [
      ...ads.map(
        (row): CostEntry => ({
          id: row.id,
          dateFrom: row.date,
          dateTo: row.date,
          channel: row.channel as ChannelId,
          campaign: row.campaign,
          campaignName: `${PLATFORM_LABEL[row.platform] ?? row.platform} · ${row.campaignName}`,
          amountAmd: row.amountAmd,
          originalAmount: row.originalAmount,
          currency: row.currency,
          rateToAmd: Number(row.rateToAmd),
          source: row.origin === 'csv' ? 'csv' : 'api',
          note: `${row.impressions} impressions, ${row.clicks} clicks`,
          manualId: null,
        }),
      ),
      ...manual.map((cost): CostEntry => {
        const ref = refs.get(cost.id) ?? null;
        return {
          id: cost.id,
          dateFrom: cost.dateFrom,
          dateTo: cost.dateTo,
          channel: cost.channel,
          campaign: cost.campaign,
          campaignName: null,
          amountAmd: cost.amountAmd,
          originalAmount: cost.originalAmount,
          currency: cost.currency,
          rateToAmd: cost.rateToAmd,
          source: ref?.startsWith('event_hub:') ? 'event_hub' : 'manual',
          note: cost.description,
          // Costs sent by Event Hub are replaced on the next message, so they are not edited here.
          manualId: ref ? null : cost.id,
        };
      }),
    ];
    return entries.sort((a, b) => b.dateFrom.localeCompare(a.dateFrom) || b.amountAmd - a.amountAmd);
  }

  /** Channel cost per week (ranges up to 120 days) or month inside the period, for the spend-over-time chart. */
  async trend(range: DateRange): Promise<{ granularity: 'week' | 'month'; points: { start: string; channels: Record<string, number> }[] }> {
    const granularity = days(range.from, range.to) <= 120 ? 'week' : 'month';
    const buckets: DateRange[] = [];
    for (let from = range.from; from <= range.to; ) {
      let to: string;
      if (granularity === 'week') {
        const weekday = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
        to = shiftDay(from, 6 - weekday);
      } else {
        const [y, m] = from.split('-').map(Number) as [number, number];
        to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      }
      if (to > range.to) to = range.to;
      buckets.push({ from, to });
      from = shiftDay(to, 1);
    }
    const points = await Promise.all(
      buckets.map(async (bucket) => ({
        start: bucket.from,
        channels: Object.fromEntries((await this.channelCosts(bucket)).map((row) => [row.channel, row.totalAmd])),
      })),
    );
    return { granularity, points };
  }

  private async validate(input: CostInput) {
    if (!(CHANNEL_IDS as string[]).includes(input.channel)) throw new CostError('channel', 'Choose a channel');
    const description = input.description.trim();
    if (!description) throw new CostError('description', 'Say what the cost is for, e.g. Agency fee, October');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) || Number.isNaN(Date.parse(input.dateFrom))) throw new CostError('dateFrom', 'Enter the first day of the spend');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo) || Number.isNaN(Date.parse(input.dateTo))) throw new CostError('dateTo', 'Enter the last day of the spend');
    if (input.dateTo < input.dateFrom) throw new CostError('dateTo', 'The last day cannot be before the first');
    if (days(input.dateFrom, input.dateTo) > 366) throw new CostError('dateTo', 'Enter costs for at most one year at a time');
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e10) throw new CostError('amount', 'Enter an amount above zero');
    const currency = input.currency.toUpperCase();
    if (!(COST_CURRENCIES as readonly string[]).includes(currency)) throw new CostError('currency', 'Choose a currency');
    let rate: number;
    try {
      rate = await this.rates.rateToAmd(currency, input.dateFrom);
    } catch (error) {
      throw new CostError('currency', `No exchange rate: ${(error as Error).message}`);
    }
    const campaign = input.campaign ? slug(input.campaign) || null : null;
    return {
      channel: input.channel,
      campaign,
      description: description.slice(0, 300),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      amountAmd: Math.round(input.amount * rate),
      originalAmount: input.amount.toFixed(2),
      currency,
      rateToAmd: String(rate),
    };
  }
}

function view(row: typeof manualCosts.$inferSelect): ManualCost {
  return {
    id: row.id,
    channel: row.channel as ChannelId,
    campaign: row.campaign,
    description: row.description,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    amountAmd: row.amountAmd,
    originalAmount: row.originalAmount,
    currency: row.currency,
    rateToAmd: Number(row.rateToAmd),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
  };
}
