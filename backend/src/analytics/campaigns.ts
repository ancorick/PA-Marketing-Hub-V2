import { eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { CHANNEL_IDS, type ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { adSpendDaily, events, manualCosts, marketingCampaigns, sends, trackedLinks } from '../db/schema.js';
import { eventCampaignKey } from '../eventhub/service.js';
import { slug } from './links.js';

export type CampaignRecord = {
  key: string;
  name: string;
  channel: ChannelId | null;
  dateFrom: string | null;
  dateTo: string | null;
  budgetAmd: number | null;
  /** Saved in the campaign list (false: only seen in links, ad spend, costs, events or emails). */
  registered: boolean;
  /** Where the campaign key was seen. */
  seenIn: ('links' | 'ad_spend' | 'costs' | 'events' | 'emails')[];
  updatedAt: string | null;
};

export type CampaignInput = { key?: string | null; name: string; channel: string; dateFrom?: string | null; dateTo?: string | null; budgetAmd?: number | null };

export class CampaignError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const YEREVAN = 4 * 3_600_000;
const dayOf = (at: Date) => new Date(at.getTime() + YEREVAN).toISOString().slice(0, 10);
const PLATFORM: Record<string, string> = { meta_ads: 'Meta Ads', google_ads: 'Google Ads' };
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * The campaign list of Campaigns & links (PRD 9.3, 12.3): one row per campaign key (utm_campaign). Saved
 * campaigns carry a name, channel, dates and budget; keys seen elsewhere (tracked links, ad spend, manual and
 * Event Hub costs, events, campaign emails and newsletters) are listed with what those records say, so nothing
 * that produced a touch is missing from the list.
 */
export class CampaignRegistry {
  constructor(private readonly db: AppPgDatabase) {}

  async list(): Promise<CampaignRecord[]> {
    const [saved, links, ads, costs, eventRows, sendRows] = await Promise.all([
      this.db.select().from(marketingCampaigns),
      this.db
        .select({ key: trackedLinks.utmCampaign, channel: sql<string>`min(${trackedLinks.channel})`, first: sql<Date>`min(${trackedLinks.createdAt})` })
        .from(trackedLinks)
        .groupBy(trackedLinks.utmCampaign),
      this.db
        .select({
          key: adSpendDaily.campaign,
          name: sql<string>`min(${adSpendDaily.campaignName})`,
          platform: sql<string>`min(${adSpendDaily.platform})`,
          channel: sql<string>`min(${adSpendDaily.channel})`,
          from: sql<string>`min(${adSpendDaily.date})::text`,
          to: sql<string>`max(${adSpendDaily.date})::text`,
        })
        .from(adSpendDaily)
        .groupBy(adSpendDaily.campaign),
      this.db
        .select({
          key: manualCosts.campaign,
          name: sql<string>`min(${manualCosts.description})`,
          channel: sql<string>`min(${manualCosts.channel})`,
          from: sql<string>`min(${manualCosts.dateFrom})::text`,
          to: sql<string>`max(${manualCosts.dateTo})::text`,
        })
        .from(manualCosts)
        .where(isNull(manualCosts.deletedAt))
        .groupBy(manualCosts.campaign)
        .having(isNotNull(manualCosts.campaign)),
      this.db.select({ id: events.id, externalId: events.externalId, title: events.title, startsAt: events.startsAt }).from(events),
      this.db
        .select({ key: sends.utmCampaign, name: sql<string>`min(${sends.name})`, at: sql<Date>`min(coalesce(${sends.finishedAt}, ${sends.scheduledAt}, ${sends.createdAt}))` })
        .from(sends)
        .groupBy(sends.utmCampaign),
    ]);

    const rows = new Map<string, CampaignRecord>();
    const seen = (key: string, where: CampaignRecord['seenIn'][number], fill: Partial<CampaignRecord>) => {
      const row = rows.get(key) ?? { key, name: key, channel: null, dateFrom: null, dateTo: null, budgetAmd: null, registered: false, seenIn: [], updatedAt: null };
      if (!row.seenIn.includes(where)) row.seenIn.push(where);
      if (!row.registered) {
        // The most descriptive source names the campaign: ad platforms and events first, then emails, costs, links.
        if (fill.name && row.name === key) row.name = fill.name;
        if (fill.channel && !row.channel) row.channel = fill.channel;
        if (fill.dateFrom && (!row.dateFrom || fill.dateFrom < row.dateFrom)) row.dateFrom = fill.dateFrom;
        if (fill.dateTo && (!row.dateTo || fill.dateTo > row.dateTo)) row.dateTo = fill.dateTo;
      }
      rows.set(key, row);
    };
    for (const row of saved) {
      rows.set(row.key, {
        key: row.key,
        name: row.name,
        channel: row.channel as ChannelId,
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
        budgetAmd: row.budgetAmd,
        registered: true,
        seenIn: [],
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    const channel = (value: string | null) => ((CHANNEL_IDS as string[]).includes(value ?? '') ? (value as ChannelId) : null);
    for (const row of ads) seen(row.key, 'ad_spend', { name: `${PLATFORM[row.platform] ?? row.platform} · ${row.name}`, channel: channel(row.channel), dateFrom: row.from, dateTo: row.to });
    for (const row of eventRows) {
      const day = dayOf(row.startsAt);
      seen(eventCampaignKey(row), 'events', { name: row.title, channel: 'events', dateFrom: day, dateTo: day });
    }
    for (const row of sendRows) {
      const day = row.at ? dayOf(new Date(row.at)) : null;
      seen(row.key, 'emails', { name: row.name, channel: 'email', dateFrom: day, dateTo: day });
    }
    for (const row of costs) if (row.key) seen(row.key, 'costs', { name: row.name, channel: channel(row.channel), dateFrom: row.from, dateTo: row.to });
    for (const row of links) seen(row.key, 'links', { channel: channel(row.channel), dateFrom: row.first ? dayOf(new Date(row.first)) : null });
    // Events without registrations or costs still belong to the list; anything else keeps the key as its name.
    return [...rows.values()].sort((a, b) => (b.dateFrom ?? '').localeCompare(a.dateFrom ?? '') || a.name.localeCompare(b.name));
  }

  /** Creates a campaign, or saves name, channel, dates and budget of a key seen elsewhere. */
  async save(input: CampaignInput, actor: string, existingKey?: string): Promise<CampaignRecord> {
    const name = input.name.trim();
    if (!name) throw new CampaignError('name', 'Give the campaign a name');
    if (name.length > 200) throw new CampaignError('name', 'Keep the name under 200 characters');
    const key = existingKey ?? slug(input.key?.trim() || name);
    if (!key) throw new CampaignError('key', 'Use letters or digits in the campaign tag');
    if (!(CHANNEL_IDS as string[]).includes(input.channel)) throw new CampaignError('channel', 'Choose a channel');
    const dateFrom = input.dateFrom || null;
    const dateTo = input.dateTo || null;
    if (dateFrom && !isDay(dateFrom)) throw new CampaignError('dateFrom', 'Enter the first day');
    if (dateTo && !isDay(dateTo)) throw new CampaignError('dateTo', 'Enter the last day');
    if (dateFrom && dateTo && dateTo < dateFrom) throw new CampaignError('dateTo', 'The last day cannot be before the first');
    const budget = input.budgetAmd ?? null;
    if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 2_000_000_000)) throw new CampaignError('budgetAmd', 'Enter a budget in AMD, zero or more');
    if (!existingKey) {
      const [taken] = await this.db.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(eq(marketingCampaigns.key, key));
      if (taken) throw new CampaignError('key', `A campaign with the tag ${key} already exists`);
    }
    const values = { name, channel: input.channel, dateFrom, dateTo, budgetAmd: budget === null ? null : Math.round(budget), updatedBy: actor };
    await this.db
      .insert(marketingCampaigns)
      .values({ key, ...values, createdBy: actor })
      .onConflictDoUpdate({ target: marketingCampaigns.key, set: values });
    const record = (await this.list()).find((row) => row.key === key);
    return record!;
  }
}
