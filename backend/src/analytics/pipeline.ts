import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { channelFromUtm } from '../contacts/channels.js';
import type { ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { adSpendDaily, rawRecords, socialDaily, webTrafficDaily } from '../db/schema.js';
import { parseCsv } from '../imports/csv.js';
import type { JobDefinition, JobResult } from '../jobs/runner.js';
import type { AdPlatformClient, AdSpendRow, AnalyticsSources, DateRange, SocialRow, WebTrafficRow } from './sources/contract.js';

const DAY = 86_400_000;
/** Yerevan is UTC+4 all year (no daylight saving). */
const YEREVAN_OFFSET = 4 * 60 * 60_000;
/** Platforms restate recent days (late conversions, invalid clicks), so each pull re-reads three days. */
const OVERLAP_DAYS = 3;
/** First pull of a source backfills this far. */
const BACKFILL_DAYS = 90;
/** 03:00 Yerevan: the nightly run finishes well before 07:00 (NFR-F6). */
export const NIGHTLY_UTC = '23:00';
/** Raw data is kept 13 months (12.4); clean and aggregated tables stay. */
const RAW_RETENTION_MONTHS = 13;

const AD_CHANNEL: Record<string, ChannelId> = { meta_ads: 'paid_social', google_ads: 'paid_search' };

export const yerevanDate = (at: Date) => new Date(at.getTime() + YEREVAN_OFFSET).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Maps utm_source / utm_medium to a channel; null = unmapped (ANL-03). */
export type ChannelMapper = (source: string | null, medium: string | null) => Promise<ChannelId | null>;

type PipelineDeps = {
  db: AppPgDatabase;
  sources: AnalyticsSources;
  mapChannel?: ChannelMapper;
  now?: () => Date;
};

export class CsvRowError extends Error {
  constructor(readonly errors: { line: number; message: string }[]) {
    super(`${errors.length} row(s) could not be read`);
  }
}

/**
 * Extract, load, transform (PRD 9.2, ANL-01, ANL-02). Every pull stores the raw response with its window and
 * pull time, then upserts clean rows by their natural key, so re-running any date range gives identical
 * tables. `rebuild` replays stored raw responses for a range without calling the source again.
 */
export class AnalyticsPipeline {
  private readonly now: () => Date;
  private readonly mapChannel: ChannelMapper;

  constructor(private readonly deps: PipelineDeps) {
    this.now = deps.now ?? (() => new Date());
    this.mapChannel = deps.mapChannel ?? (async (source, medium) => channelFromUtm(source, medium));
  }

  /** Source names as the Data Health page shows them. */
  sourceNames(): string[] {
    return [this.deps.sources.web.name, ...this.deps.sources.social.map((s) => s.name), ...this.deps.sources.ads.map((a) => a.name)];
  }

  jobs(): JobDefinition[] {
    const nightly = (name: string, description: string, pull: (range: DateRange) => Promise<JobResult>): JobDefinition => ({
      name,
      description,
      intervalMs: 0,
      dailyAtUtc: NIGHTLY_UTC,
      run: ({ windowFrom, windowTo }) => {
        const range = this.windowRange(windowFrom, windowTo);
        return range ? pull(range) : Promise.resolve({ rowsIn: 0, rowsUpserted: 0 });
      },
    });
    const { web, social, ads } = this.deps.sources;
    return [
      nightly(web.name, 'Website analytics: sessions and conversions', (range) => this.pullWeb(range)),
      ...social.map((client) => nightly(client.name, `Social platform metrics (${client.name})`, (range) => this.pullSocial(client.name, range))),
      ...ads.map((client) => nightly(client.name, `Ad platform spend (${client.name})`, (range) => this.pullAds(client, range))),
      { name: 'raw_retention', description: 'Delete raw API responses older than 13 months', intervalMs: 0, dailyAtUtc: '22:30', run: () => this.pruneRaw() },
    ];
  }

  /** Complete Yerevan days from the window start (minus overlap) to yesterday; null when nothing is due. */
  windowRange(windowFrom: Date | null, windowTo: Date): DateRange | null {
    const to = addDays(yerevanDate(windowTo), -1);
    const from = windowFrom ? addDays(yerevanDate(windowFrom), -OVERLAP_DAYS) : addDays(to, -BACKFILL_DAYS + 1);
    return from <= to ? { from, to } : null;
  }

  /** Runs a source for an explicit range (admin re-run of a date range, ANL-02). */
  async pull(source: string, range: DateRange): Promise<JobResult> {
    const { web, social, ads } = this.deps.sources;
    if (source === web.name) return this.pullWeb(range);
    if (social.some((client) => client.name === source)) return this.pullSocial(source, range);
    const ad = ads.find((client) => client.name === source);
    if (ad) return this.pullAds(ad, range);
    throw new Error(`Unknown source ${source}`);
  }

  async pullWeb(range: DateRange): Promise<JobResult> {
    const pulled = await this.deps.sources.web.dailyTraffic(range);
    await this.storeRaw(this.deps.sources.web.name, pulled.endpoint, range, pulled.raw);
    return this.loadWeb(pulled.rows, range);
  }

  async pullSocial(name: string, range: DateRange): Promise<JobResult> {
    const client = this.deps.sources.social.find((item) => item.name === name);
    if (!client) throw new Error(`Unknown social source ${name}`);
    const pulled = await client.dailyMetrics(range);
    await this.storeRaw(name, pulled.endpoint, range, pulled.raw);
    return this.loadSocial(pulled.rows, range);
  }

  async pullAds(client: AdPlatformClient, range: DateRange): Promise<JobResult> {
    const pulled = await client.dailyCampaigns(range);
    await this.storeRaw(client.name, pulled.endpoint, range, pulled.raw);
    return this.loadAds(client.name, pulled.rows, 'api', range);
  }

  /** Re-transforms stored raw responses for a range, oldest pull first so the latest pull wins (9.2). */
  async rebuild(source: string, range: DateRange): Promise<JobResult> {
    const records = await this.deps.db
      .select()
      .from(rawRecords)
      .where(and(eq(rawRecords.source, source), lte(rawRecords.windowFrom, range.to), gte(rawRecords.windowTo, range.from)))
      .orderBy(asc(rawRecords.pulledAt));
    const { web, social, ads } = this.deps.sources;
    const total: JobResult = { rowsIn: 0, rowsUpserted: 0 };
    for (const record of records) {
      let result: JobResult;
      if (source === web.name) result = await this.loadWeb(web.parse(record.payload), range);
      else if (social.some((client) => client.name === source)) result = await this.loadSocial((social.find((client) => client.name === source) as (typeof social)[number]).parse(record.payload), range);
      else {
        const platform = source.startsWith('ads_csv:') ? source.slice('ads_csv:'.length) : source;
        const ad = ads.find((client) => client.name === platform);
        const rows = source.startsWith('ads_csv:') ? (record.payload as { rows: AdSpendRow[] }).rows : ad?.parse(record.payload);
        if (!rows) throw new Error(`Unknown source ${source}`);
        result = await this.loadAds(platform, rows, source.startsWith('ads_csv:') ? 'csv' : 'api', range);
      }
      total.rowsIn += result.rowsIn;
      total.rowsUpserted += result.rowsUpserted;
    }
    return total;
  }

  /**
   * Ad platform CSV export, the fallback in 9.1. Columns: date, campaign_id, campaign_name, spend, currency;
   * optional utm_campaign, impressions, clicks, leads. Nothing is stored unless every row is valid.
   */
  async importAdCsv(platform: string, csv: string): Promise<JobResult & { range: DateRange | null }> {
    if (!AD_CHANNEL[platform]) throw new CsvRowError([{ line: 0, message: `Unknown platform ${platform}` }]);
    const { rows } = parseCsv(csv, 50_000);
    const [header, ...body] = rows;
    const columns = (header ?? []).map((name) => name.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = ['date', 'campaign_id', 'campaign_name', 'spend', 'currency'].filter((name) => !columns.includes(name));
    if (missing.length) throw new CsvRowError([{ line: 1, message: `Missing column(s): ${missing.join(', ')}` }]);
    const errors: { line: number; message: string }[] = [];
    const parsed: AdSpendRow[] = [];
    const count = (value: string | undefined) => (value === undefined || value.trim() === '' ? 0 : Number(value.replace(/\s/g, '')));
    body.forEach((cells, index) => {
      const get = (name: string) => cells[columns.indexOf(name)]?.trim();
      const line = index + 2;
      const day = get('date') ?? '';
      const spend = Number((get('spend') ?? '').replace(/\s/g, '').replace(',', '.'));
      const numbers = { impressions: count(get('impressions')), clicks: count(get('clicks')), leads: count(get('leads')) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) errors.push({ line, message: 'date must be YYYY-MM-DD' });
      else if (!get('campaign_id') || !get('campaign_name')) errors.push({ line, message: 'campaign_id and campaign_name are required' });
      else if (!Number.isFinite(spend) || spend < 0) errors.push({ line, message: 'spend must be a number ≥ 0' });
      else if (!/^[A-Za-z]{3}$/.test(get('currency') ?? '')) errors.push({ line, message: 'currency must be a three-letter code' });
      else if (Object.values(numbers).some((n) => !Number.isInteger(n) || n < 0)) errors.push({ line, message: 'impressions, clicks and leads must be whole numbers' });
      else
        parsed.push({
          date: day,
          campaignId: get('campaign_id') as string,
          campaignName: get('campaign_name') as string,
          utmCampaign: get('utm_campaign') || null,
          spend,
          currency: (get('currency') as string).toUpperCase(),
          ...numbers,
        });
    });
    if (errors.length) throw new CsvRowError(errors.slice(0, 50));
    if (parsed.length === 0) return { rowsIn: 0, rowsUpserted: 0, range: null };
    const dates = parsed.map((row) => row.date).sort();
    const range = { from: dates[0] as string, to: dates[dates.length - 1] as string };
    await this.storeRaw(`ads_csv:${platform}`, 'csv_upload', range, { rows: parsed });
    return { ...(await this.loadAds(platform, parsed, 'csv', range)), range };
  }

  async pruneRaw(): Promise<JobResult> {
    const cutoff = new Date(this.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RAW_RETENTION_MONTHS);
    const deleted = await this.deps.db.delete(rawRecords).where(lt(rawRecords.pulledAt, cutoff)).returning({ id: rawRecords.id });
    return { rowsIn: deleted.length, rowsUpserted: deleted.length };
  }

  private async storeRaw(source: string, endpoint: string, range: DateRange, payload: unknown) {
    await this.deps.db.insert(rawRecords).values({ source, endpoint, windowFrom: range.from, windowTo: range.to, payload, pulledAt: this.now() });
  }

  private inRange = (day: string, range: DateRange) => day >= range.from && day <= range.to;

  private async loadWeb(rows: WebTrafficRow[], range: DateRange): Promise<JobResult> {
    const inside = rows.filter((row) => this.inRange(row.date, range));
    for (const row of inside) {
      const values = {
        date: row.date,
        utmSource: row.utmSource ?? '',
        utmMedium: row.utmMedium ?? '',
        utmCampaign: row.utmCampaign ?? '',
        landingPage: row.landingPage,
        channel: await this.mapChannel(row.utmSource, row.utmMedium),
        sessions: row.sessions,
        conversions: row.conversions,
      };
      await this.deps.db
        .insert(webTrafficDaily)
        .values(values)
        .onConflictDoUpdate({
          target: [webTrafficDaily.date, webTrafficDaily.utmSource, webTrafficDaily.utmMedium, webTrafficDaily.utmCampaign, webTrafficDaily.landingPage],
          set: { channel: values.channel, sessions: values.sessions, conversions: values.conversions },
        });
    }
    return { rowsIn: rows.length, rowsUpserted: inside.length };
  }

  private async loadSocial(rows: SocialRow[], range: DateRange): Promise<JobResult> {
    const inside = rows.filter((row) => this.inRange(row.date, range));
    for (const row of inside) {
      await this.deps.db
        .insert(socialDaily)
        .values(row)
        .onConflictDoUpdate({
          target: [socialDaily.platform, socialDaily.accountId, socialDaily.date],
          set: { reach: row.reach, engagement: row.engagement, followers: row.followers, leadForms: row.leadForms },
        });
    }
    return { rowsIn: rows.length, rowsUpserted: inside.length };
  }

  private async loadAds(platform: string, rows: AdSpendRow[], origin: 'api' | 'csv', range: DateRange): Promise<JobResult> {
    const inside = rows.filter((row) => this.inRange(row.date, range));
    for (const row of inside) {
      const rate = await this.deps.sources.rates.rateToAmd(row.currency, row.date);
      const values = {
        date: row.date,
        platform,
        platformCampaignId: row.campaignId,
        campaignName: row.campaignName,
        campaign: (row.utmCampaign ?? row.campaignName).trim().toLowerCase(),
        channel: AD_CHANNEL[platform] as string,
        amountAmd: Math.round(row.spend * rate),
        originalAmount: row.spend.toFixed(2),
        currency: row.currency.toUpperCase(),
        rateToAmd: String(rate),
        impressions: row.impressions,
        clicks: row.clicks,
        leads: row.leads,
        origin,
      };
      const { date: _date, platform: _platform, platformCampaignId: _id, ...set } = values;
      await this.deps.db.insert(adSpendDaily).values(values).onConflictDoUpdate({ target: [adSpendDaily.platform, adSpendDaily.platformCampaignId, adSpendDaily.date], set });
    }
    return { rowsIn: rows.length, rowsUpserted: inside.length };
  }

  /** Row counts per clean table, for the Data Health page. */
  async rowCounts() {
    const count = async (table: typeof webTrafficDaily | typeof socialDaily | typeof adSpendDaily) =>
      Number((await this.deps.db.select({ n: sql<number>`count(*)` }).from(table))[0]?.n ?? 0);
    return { webTraffic: await count(webTrafficDaily), social: await count(socialDaily), adSpend: await count(adSpendDaily) };
  }
}
