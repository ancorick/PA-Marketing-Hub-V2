import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { BY_MEDIUM } from '../contacts/channels.js';
import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { channelRules, contacts, touchpoints, unmappedValues, webTrafficDaily } from '../db/schema.js';

export const RULE_KINDS = ['source_medium', 'medium', 'source', 'crm_label'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type ChannelRule = { id: string | null; kind: RuleKind; value: string; channel: ChannelId; builtIn: boolean; createdBy: string | null };
export type UnmappedValue = {
  id: string;
  source: string;
  field: 'utm' | 'crm_label';
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  resolvedChannelId: ChannelId | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export class TaxonomyError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const NONE = '(none)';
const clean = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';
const isChannel = (value: string): value is ChannelId => (CHANNEL_IDS as string[]).includes(value);

const BUILT_IN: ChannelRule[] = [
  ...Object.entries(BY_MEDIUM).map(([value, channel]) => ({ id: null, kind: 'medium' as const, value, channel, builtIn: true, createdBy: null })),
  { id: null, kind: 'source', value: 'chatbot', channel: 'chatbot', builtIn: true, createdBy: null },
  ...['website', 'web', 'site'].map((value) => ({ id: null, kind: 'crm_label' as const, value, channel: 'search_website' as const, builtIn: true, createdBy: null })),
];

/**
 * One channel taxonomy (PRD 9.2, 9.3, ANL-03). Campaign parameters and CRM channel labels map to a channel
 * through staff rules first, then built-in rules. A value nothing matches is returned as null and queued in
 * unmapped_values for review; resolving it adds a rule and remaps the rows already stored.
 */
export class ChannelTaxonomy {
  private cache: Map<string, ChannelId> | null = null;

  constructor(
    private readonly db: AppPgDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  channels() {
    return CHANNELS.map((channel) => ({ ...channel }));
  }

  async rules(): Promise<ChannelRule[]> {
    const rows = await this.db.select().from(channelRules).orderBy(asc(channelRules.kind), asc(channelRules.value));
    return [
      ...rows.map((row) => ({ id: row.id, kind: row.kind as RuleKind, value: row.value, channel: row.channel as ChannelId, builtIn: false, createdBy: row.createdBy })),
      ...BUILT_IN,
    ];
  }

  async addRule(input: { kind: RuleKind; value: string; channel: string }, actor: string): Promise<ChannelRule> {
    if (!isChannel(input.channel)) throw new TaxonomyError('channel', 'Unknown channel');
    const value = input.kind === 'source_medium' ? input.value.split('/').map(clean).join('/') : clean(input.value);
    if (!value || (input.kind === 'source_medium' && !/^[^/]+\/[^/]+$/.test(value))) throw new TaxonomyError('value', input.kind === 'source_medium' ? 'Use source/medium, e.g. tiktok/influencer' : 'Enter a value');
    const [row] = await this.db
      .insert(channelRules)
      .values({ kind: input.kind, value, channel: input.channel, createdBy: actor })
      .onConflictDoUpdate({ target: [channelRules.kind, channelRules.value], set: { channel: input.channel, createdBy: actor } })
      .returning();
    this.cache = null;
    return { id: row!.id, kind: input.kind, value, channel: input.channel, builtIn: false, createdBy: actor };
  }

  async deleteRule(id: string): Promise<boolean> {
    const deleted = await this.db.delete(channelRules).where(eq(channelRules.id, id)).returning({ id: channelRules.id });
    this.cache = null;
    return deleted.length > 0;
  }

  /** utm_source / utm_medium → channel. No parameters at all is a direct visit (Search and website). */
  async mapUtm(source: string | null | undefined, medium: string | null | undefined, origin: string, options: { queue?: boolean } = {}): Promise<ChannelId | null> {
    const s = clean(source);
    const m = clean(medium);
    if (!s && !m) return 'search_website';
    const rules = await this.lookup();
    const channel =
      (s && m ? rules.get(`custom:source_medium:${s}/${m}`) : undefined) ??
      (m ? rules.get(`custom:medium:${m}`) : undefined) ??
      (s ? rules.get(`custom:source:${s}`) : undefined) ??
      (m ? rules.get(`builtin:medium:${m}`) : undefined) ??
      (s ? rules.get(`builtin:source:${s}`) : undefined);
    if (channel) return channel;
    if (options.queue !== false) await this.queue(origin, 'utm', `${s || NONE} / ${m || NONE}`);
    return null;
  }

  /** Navigator CRM channel label → channel (labels may be channel slugs, "website" or a utm medium). */
  async mapCrmLabel(label: string | null | undefined): Promise<ChannelId | null> {
    const value = clean(label);
    // "unmapped" is what sign-up sends the CRM for parameters already queued under utm.
    if (!value || value === 'unmapped') return null;
    if (isChannel(value)) return value;
    const rules = await this.lookup();
    const channel = rules.get(`custom:crm_label:${value}`) ?? rules.get(`builtin:crm_label:${value}`) ?? rules.get(`builtin:medium:${value}`) ?? rules.get(`builtin:source:${value}`);
    if (channel) return channel;
    await this.queue('navigator_crm', 'crm_label', value);
    return null;
  }

  async unmapped(options: { includeResolved?: boolean } = {}): Promise<UnmappedValue[]> {
    const rows = await this.db
      .select()
      .from(unmappedValues)
      .where(options.includeResolved ? undefined : isNull(unmappedValues.resolvedAt))
      .orderBy(sql`${unmappedValues.resolvedAt} is not null`, desc(unmappedValues.count));
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      field: row.field as UnmappedValue['field'],
      value: row.value,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      count: row.count,
      resolvedChannelId: (row.resolvedChannelId as ChannelId | null) ?? null,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Assigns a channel to an unmapped value: adds the rule, marks the value resolved and remaps stored rows
   * (website traffic, touchpoints and the source channel of contacts they created). CRM labels apply on the
   * next lead sync, which fills a contact's empty source channel.
   */
  async resolve(id: string, channel: string, actor: string): Promise<{ value: UnmappedValue; remapped: { webTraffic: number; touchpoints: number; contacts: number } }> {
    if (!isChannel(channel)) throw new TaxonomyError('channel', 'Unknown channel');
    const [row] = await this.db.select().from(unmappedValues).where(eq(unmappedValues.id, id));
    if (!row) throw new TaxonomyError('id', 'Unknown value');
    const remapped = { webTraffic: 0, touchpoints: 0, contacts: 0 };
    if (row.field === 'utm') {
      const [s, m] = row.value.split(' / ').map((part) => (part === NONE ? '' : part)) as [string, string];
      if (s && m) await this.addRule({ kind: 'source_medium', value: `${s}/${m}`, channel }, actor);
      else await this.addRule({ kind: s ? 'source' : 'medium', value: s || m, channel }, actor);
      const web = await this.db
        .update(webTrafficDaily)
        .set({ channel })
        .where(and(isNull(webTrafficDaily.channel), sql`lower(${webTrafficDaily.utmSource}) = ${s}`, sql`lower(${webTrafficDaily.utmMedium}) = ${m}`))
        .returning({ id: webTrafficDaily.id });
      const touches = await this.db
        .update(touchpoints)
        .set({ channel })
        .where(and(isNull(touchpoints.channel), sql`lower(coalesce(${touchpoints.utmSource}, '')) = ${s}`, sql`lower(coalesce(${touchpoints.utmMedium}, '')) = ${m}`))
        .returning({ contactId: touchpoints.contactId });
      const contactIds = [...new Set(touches.map((touch) => touch.contactId).filter((value): value is string => value !== null))];
      const updated = contactIds.length
        ? await this.db.update(contacts).set({ sourceChannel: channel }).where(and(inArray(contacts.id, contactIds), isNull(contacts.sourceChannel))).returning({ id: contacts.id })
        : [];
      Object.assign(remapped, { webTraffic: web.length, touchpoints: touches.length, contacts: updated.length });
    } else {
      await this.addRule({ kind: 'crm_label', value: row.value, channel }, actor);
    }
    await this.db.update(unmappedValues).set({ resolvedChannelId: channel, resolvedBy: actor, resolvedAt: this.now() }).where(eq(unmappedValues.id, id));
    const value = (await this.unmapped({ includeResolved: true })).find((item) => item.id === id) as UnmappedValue;
    return { value, remapped };
  }

  private async queue(source: string, field: 'utm' | 'crm_label', value: string) {
    const at = this.now();
    await this.db
      .insert(unmappedValues)
      .values({ source, field, value, firstSeenAt: at, lastSeenAt: at, count: 1 })
      .onConflictDoUpdate({
        target: [unmappedValues.source, unmappedValues.field, unmappedValues.value],
        // A resolved value seen again (its rule was deleted) goes back to the queue.
        set: { count: sql`${unmappedValues.count} + 1`, lastSeenAt: at, resolvedAt: null, resolvedBy: null, resolvedChannelId: null },
      });
  }

  private async lookup(): Promise<Map<string, ChannelId>> {
    if (this.cache) return this.cache;
    const map = new Map<string, ChannelId>();
    for (const rule of await this.rules()) map.set(`${rule.builtIn ? 'builtin' : 'custom'}:${rule.kind}:${rule.value}`, rule.channel);
    this.cache = map;
    return map;
  }
}
