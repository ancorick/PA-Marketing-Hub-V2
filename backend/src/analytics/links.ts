import { randomBytes } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { adSpendDaily, trackedLinks, touchpoints } from '../db/schema.js';
import type { ChannelTaxonomy } from './taxonomy.js';

/** utm_medium the builder uses per channel (the 9.3 table); each maps back to its channel by a built-in rule. */
export const CHANNEL_MEDIUM: Record<ChannelId, string> = {
  paid_social: 'paid_social',
  organic_social: 'social',
  search_website: 'organic',
  paid_search: 'cpc',
  email: 'email',
  events: 'offline',
  referrals: 'referral',
  chatbot: 'chat',
  partners_press: 'partner',
};

/** Suggested utm_source values per channel; any lower-case slug is accepted. */
export const CHANNEL_SOURCES: Record<ChannelId, string[]> = {
  paid_social: ['instagram', 'facebook', 'linkedin', 'tiktok'],
  organic_social: ['instagram', 'facebook', 'linkedin', 'telegram'],
  search_website: ['google', 'bing'],
  paid_search: ['google'],
  email: ['newsletter', 'campaign'],
  events: ['event', 'open_day', 'workshop'],
  referrals: ['referral'],
  chatbot: ['chatbot'],
  partners_press: [],
};

export type TrackedLink = {
  id: string;
  code: string;
  label: string | null;
  shortUrl: string;
  destinationUrl: string;
  fullUrl: string;
  channel: ChannelId;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  clicks: number;
  lastClickAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type NewLink = { destinationUrl: string; channel: ChannelId; source: string; campaign: string; content?: string | null; label?: string | null };

export class LinkBuilderError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/** Slug for campaign parameters: lower case, digits, hyphen and underscore. */
export const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

const CODE_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Campaign link builder (PRD 9.3, ANL-04): tagged URLs and short links from the channel taxonomy. */
export class LinkBuilder {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly taxonomy: Pick<ChannelTaxonomy, 'mapUtm'>,
    private readonly shortBase: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: NewLink, actor: string): Promise<TrackedLink> {
    let destination: URL;
    try {
      destination = new URL(input.destinationUrl.trim());
    } catch {
      throw new LinkBuilderError('destinationUrl', 'Enter a full address starting with https://');
    }
    if (!['https:', 'http:'].includes(destination.protocol)) throw new LinkBuilderError('destinationUrl', 'Only web addresses (https://) can be tracked');
    if ([...destination.searchParams.keys()].some((key) => key.startsWith('utm_'))) throw new LinkBuilderError('destinationUrl', 'The address already has utm_ parameters; paste it without them');
    const source = slug(input.source);
    const campaign = slug(input.campaign);
    const content = input.content ? slug(input.content) : null;
    if (!source) throw new LinkBuilderError('source', 'Enter a source, e.g. instagram');
    if (!campaign) throw new LinkBuilderError('campaign', 'Enter a campaign name');
    const medium = CHANNEL_MEDIUM[input.channel];
    if (!medium) throw new LinkBuilderError('channel', 'Unknown channel');
    // The link must land in its channel; a staff rule for this source could override the medium.
    const mapped = await this.taxonomy.mapUtm(source, medium, 'link_builder', { queue: false });
    if (mapped !== input.channel) throw new LinkBuilderError('source', `A channel rule sends ${source}/${medium} to another channel (${mapped ?? 'unmapped'}); check Channel taxonomy`);

    const full = new URL(destination.toString());
    full.searchParams.set('utm_source', source);
    full.searchParams.set('utm_medium', medium);
    full.searchParams.set('utm_campaign', campaign);
    if (content) full.searchParams.set('utm_content', content);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = [...randomBytes(7)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
      const [row] = await this.db
        .insert(trackedLinks)
        .values({
          code,
          label: input.label?.trim() || null,
          destinationUrl: destination.toString(),
          fullUrl: full.toString(),
          channel: input.channel,
          utmSource: source,
          utmMedium: medium,
          utmCampaign: campaign,
          utmContent: content,
          createdBy: actor,
        })
        .onConflictDoNothing({ target: trackedLinks.code })
        .returning();
      if (row) return this.view(row);
    }
    throw new Error('Could not allocate a short code');
  }

  async list(limit = 200): Promise<TrackedLink[]> {
    const rows = await this.db.select().from(trackedLinks).orderBy(desc(trackedLinks.createdAt)).limit(limit);
    return rows.map((row) => this.view(row));
  }

  /** Short link click: the full URL to redirect to, or null for an unknown code. */
  async resolve(code: string): Promise<string | null> {
    const [row] = await this.db
      .update(trackedLinks)
      .set({ clicks: sql`${trackedLinks.clicks} + 1`, lastClickAt: this.now() })
      .where(eq(trackedLinks.code, code))
      .returning({ fullUrl: trackedLinks.fullUrl });
    return row?.fullUrl ?? null;
  }

  /** Campaign keys known anywhere (links, touchpoints, ad spend), for pickers in the builder and cost form. */
  async campaigns(): Promise<string[]> {
    const result = await this.db.execute<{ campaign: string }>(sql`
      select distinct campaign from (
        select ${trackedLinks.utmCampaign} as campaign from ${trackedLinks}
        union select ${touchpoints.campaign} from ${touchpoints} where ${touchpoints.campaign} is not null
        union select ${adSpendDaily.campaign} from ${adSpendDaily}
      ) c order by campaign limit 500`);
    const rows = (result as unknown as { rows?: { campaign: string }[] }).rows ?? (result as unknown as { campaign: string }[]);
    return rows.map((row) => row.campaign);
  }

  private view(row: typeof trackedLinks.$inferSelect): TrackedLink {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      shortUrl: `${this.shortBase}/l/${row.code}`,
      destinationUrl: row.destinationUrl,
      fullUrl: row.fullUrl,
      channel: row.channel as ChannelId,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      utmContent: row.utmContent,
      clicks: row.clicks,
      lastClickAt: row.lastClickAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
