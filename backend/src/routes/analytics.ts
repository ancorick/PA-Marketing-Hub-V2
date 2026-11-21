import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CsvRowError, type AnalyticsPipeline } from '../analytics/pipeline.js';
import { RULE_KINDS, TaxonomyError, type ChannelTaxonomy } from '../analytics/taxonomy.js';
import { ATTRIBUTION_MODELS, MODEL_LABEL, STAGES, type AttributionService } from '../analytics/attribution.js';
import { suppress, type OverviewService } from '../analytics/overview.js';
import type { DetailService } from '../analytics/detail.js';
import type { DataHealth } from '../analytics/health.js';
import type { SelfReportedService } from '../analytics/self-reported.js';
import type { StaffSession } from '../integrations/core-engine/contract.js';
import { COST_CURRENCIES, CostError, type CostService } from '../analytics/costs.js';
import { CHANNEL_MEDIUM, CHANNEL_SOURCES, LinkBuilderError, type LinkBuilder } from '../analytics/links.js';
import { requireRole } from '../auth/staff.js';
import { CHANNEL_IDS, CHANNELS } from '../contacts/fields.js';
import { rateLimit } from '../public/rate-limit.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rerunBody = z
  .object({ from: day, to: day, mode: z.enum(['pull', 'rebuild']).default('pull') })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 400 * 86_400_000, { message: 'At most 400 days at a time', path: ['to'] });
const ruleBody = z.object({ kind: z.enum(RULE_KINDS), value: z.string().trim().min(1).max(200), channel: z.string() });
const resolveBody = z.object({ channel: z.string() });
const idParams = z.object({ id: z.string().uuid() });
const linkBody = z.object({
  destinationUrl: z.string().trim().min(1).max(2000),
  channel: z.enum(CHANNEL_IDS),
  source: z.string().max(100),
  campaign: z.string().max(100),
  content: z.string().max(100).nullish(),
  label: z.string().max(200).nullish(),
});
const costBody = z.object({
  channel: z.string(),
  campaign: z.string().max(100).nullish(),
  description: z.string().max(300),
  dateFrom: z.string(),
  dateTo: z.string(),
  amount: z.number(),
  currency: z.string().max(3),
});
const periodQuery = z
  .object({ from: day, to: day })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 800 * 86_400_000, { message: 'At most 24 months at a time', path: ['to'] });
const attributionQuery = z.object({
  model: z.enum(ATTRIBUTION_MODELS).default('first_touch'),
  by: z.enum(['channel', 'campaign']).default('channel'),
  channel: z.string().max(60).optional(),
});
const peopleQuery = z.object({
  model: z.enum(ATTRIBUTION_MODELS).default('first_touch'),
  stage: z.enum(STAGES),
  channel: z.string().min(1).max(60),
  campaign: z.string().max(100).optional(),
});
/** Marketing roles see individual numbers; everyone else gets aggregates with small numbers hidden (ANL-14, NFR-P5). */
const isShared = (staff: StaffSession | null) => !staff?.roles.some((role) => role === 'editor' || role === 'marketing_manager' || role === 'admin');
const csvBody = z.object({ platform: z.enum(['meta_ads', 'google_ads']), csv: z.string().min(1).max(5_000_000) });

/** Analytics pipeline (PRD 9.1, 9.2): re-runs of a date range (admin) and the ad spend CSV fallback. */
export async function analyticsRoutes(app: FastifyInstance, { pipeline, taxonomy, links, costs, attribution, overview, detail, health, selfReported, coreEngine }: {
    pipeline: AnalyticsPipeline;
    taxonomy: ChannelTaxonomy;
    links: LinkBuilder;
    costs: CostService;
    attribution: AttributionService;
    overview: OverviewService;
    detail: DetailService;
    health: DataHealth;
    selfReported: SelfReportedService;
    coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const admin = requireRole(coreEngine, ['admin']);
  const managers = requireRole(coreEngine, ['admin', 'marketing_manager']);
  const anyStaff = requireRole(coreEngine, ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']);
  const marketing = requireRole(coreEngine, ['admin', 'marketing_manager', 'editor']);
  const invalid = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: z.ZodError) =>
    reply.code(400).send({ error: 'invalid_request', message: error.issues[0]?.message, field: error.issues[0]?.path.join('.') });
  const taxonomyError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
    if (error instanceof TaxonomyError) return reply.code(error.field === 'id' ? 404 : 400).send({ error: error.field === 'id' ? 'not_found' : 'invalid_request', message: error.message, field: error.field });
    throw error;
  };

  // Manual costs (ANL-05): everyone who sees the dashboard sees costs; managers and admins enter them (4.3).
  const costError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
    if (error instanceof CostError) return reply.code(400).send({ error: 'invalid_request', message: error.message, field: error.field });
    throw error;
  };

  // Attribution (9.4, ANL-06, ANL-07): aggregates for every role; one model per answer, named in it.
  app.get('/api/analytics/attribution', { preHandler: anyStaff }, async (request, reply) => {
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    const { model, by, channel } = options.data;
    const rows = by === 'campaign' ? await attribution.byCampaign(period.data, model, channel) : await attribution.byChannel(period.data, model);
    const shared = isShared(request.staff);
    return {
      model,
      modelLabel: MODEL_LABEL[model],
      lookbackDays: 365,
      period: period.data,
      by,
      shared,
      rows: rows.map((row) => ({ ...row, ...Object.fromEntries(STAGES.map((stage) => [stage, suppress(row[stage], shared)])) })),
    };
  });

  // Overview (9.6, ANL-08) for every role; small numbers hidden outside marketing (ANL-14).
  app.get('/api/analytics/overview', { preHandler: anyStaff }, async (request, reply) => {
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    return overview.overview(period.data, options.data.model, isShared(request.staff));
  });

  // Channel, campaign and cohort views (9.6, ANL-09, ANL-10): aggregates for every role.
  const channelOrUnmapped = z.enum([...CHANNEL_IDS, 'unmapped', 'unattributed']);
  app.get('/api/analytics/channels/:channel', { preHandler: anyStaff }, async (request, reply) => {
    const channel = channelOrUnmapped.safeParse((request.params as { channel: string }).channel);
    if (!channel.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown channel' });
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    return detail.channel(channel.data, period.data, options.data.model, isShared(request.staff));
  });

  app.get('/api/analytics/campaigns', { preHandler: anyStaff }, async (request, reply) => {
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    const shared = isShared(request.staff);
    return { model: options.data.model, modelLabel: MODEL_LABEL[options.data.model], shared, campaigns: await detail.campaigns(period.data, options.data.model, shared) };
  });

  app.get('/api/analytics/campaigns/:key', { preHandler: anyStaff }, async (request, reply) => {
    const key = z.string().min(1).max(100).safeParse((request.params as { key: string }).key);
    if (!key.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown campaign' });
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    return detail.campaign(key.data, period.data, options.data.model, isShared(request.staff));
  });

  app.get('/api/analytics/cohorts', { preHandler: anyStaff }, async (request, reply) => {
    const options = attributionQuery.safeParse(request.query);
    if (!options.success) return invalid(reply, options.error);
    const channel = options.data.channel ? channelOrUnmapped.safeParse(options.data.channel) : null;
    if (channel && !channel.success) return reply.code(400).send({ error: 'invalid_request', message: 'Unknown channel', field: 'channel' });
    return detail.cohorts(options.data.model, isShared(request.staff), channel?.data);
  });

  // Self-reported source against tracked first touch (9.4, ANL-16): a check on tracking gaps.
  app.get('/api/analytics/self-reported', { preHandler: anyStaff }, async (request, reply) => {
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    return selfReported.compare(period.data, isShared(request.staff));
  });

  // The contacts behind a number (ANL-15): marketing roles only, as they are individual records (4.3).
  app.get('/api/analytics/people', { preHandler: marketing }, async (request, reply) => {
    const period = periodQuery.safeParse(request.query);
    if (!period.success) return invalid(reply, period.error);
    const query = peopleQuery.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error);
    const { model, stage, channel, campaign } = query.data;
    const { total, people } = await overview.people(period.data, model, stage, channel, campaign);
    return { model, modelLabel: MODEL_LABEL[model], stage, channel, campaign: campaign ?? null, total, people };
  });

  // One person's credits under every model: individual data, so the marketing team only (4.3).
  app.get('/api/analytics/attribution/contacts/:id', { preHandler: marketing }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown contact' });
    return attribution.forContact(params.data.id);
  });

  // The taxonomy's channel list (9.3) for every analytics view.
  app.get('/api/analytics/channels', { preHandler: anyStaff }, async () => ({ channels: CHANNELS }));

  app.get('/api/analytics/costs', { preHandler: anyStaff }, async (request, reply) => {
    const query = periodQuery.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error);
    return { costs: await costs.list(query.data), channels: await costs.channelCosts(query.data), currencies: COST_CURRENCIES };
  });

  app.post('/api/analytics/costs', { preHandler: managers }, async (request, reply) => {
    const body = costBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return reply.code(201).send(await costs.create(body.data, request.staff!.userId));
    } catch (error) {
      return costError(reply, error);
    }
  });

  app.put('/api/analytics/costs/:id', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = costBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      const updated = params.success ? await costs.update(params.data.id, body.data, request.staff!.userId) : null;
      return updated ?? reply.code(404).send({ error: 'not_found', message: 'Unknown cost' });
    } catch (error) {
      return costError(reply, error);
    }
  });

  app.delete('/api/analytics/costs/:id', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await costs.remove(params.data.id, request.staff!.userId))) return reply.code(404).send({ error: 'not_found', message: 'Unknown cost' });
    return reply.code(204).send();
  });

  // Campaign link builder (9.3, ANL-04): editors and managers create links; everyone in marketing sees them.
  app.get('/api/analytics/links', { preHandler: marketing }, async () => ({
    links: await links.list(),
    campaigns: await links.campaigns(),
    channels: CHANNELS.map((channel) => ({ ...channel, medium: CHANNEL_MEDIUM[channel.id], sources: CHANNEL_SOURCES[channel.id] })),
  }));

  app.post('/api/analytics/links', { preHandler: marketing }, async (request, reply) => {
    const body = linkBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return reply.code(201).send(await links.create(body.data, request.staff!.userId));
    } catch (error) {
      if (error instanceof LinkBuilderError) return reply.code(400).send({ error: 'invalid_request', message: error.message, field: error.field });
      throw error;
    }
  });

  // Short links are public: anyone who sees the post or ad opens them.
  app.get('/l/:code', { preHandler: rateLimit({ max: 120, windowMs: 60_000 }) }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const target = /^[A-Za-z0-9]{4,16}$/.test(code) ? await links.resolve(code) : null;
    if (!target) return reply.code(404).type('text/plain; charset=utf-8').send('This link does not exist.');
    return reply.code(302).header('cache-control', 'no-store').redirect(target);
  });

  // Channel taxonomy (9.3, ANL-03): marketing staff see it; managers and admins change it.
  app.get('/api/analytics/taxonomy', { preHandler: marketing }, async () => ({
    channels: taxonomy.channels(),
    rules: await taxonomy.rules(),
    unmapped: await taxonomy.unmapped({ includeResolved: true }),
  }));

  app.post('/api/analytics/taxonomy/rules', { preHandler: managers }, async (request, reply) => {
    const body = ruleBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return reply.code(201).send(await taxonomy.addRule(body.data, request.staff!.userId));
    } catch (error) {
      return taxonomyError(reply, error);
    }
  });

  app.delete('/api/analytics/taxonomy/rules/:id', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !(await taxonomy.deleteRule(params.data.id))) return reply.code(404).send({ error: 'not_found', message: 'Unknown rule (built-in rules cannot be deleted)' });
    return reply.code(204).send();
  });

  app.post('/api/analytics/unmapped/:id/resolve', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown value' });
    const body = resolveBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return await taxonomy.resolve(params.data.id, body.data.channel, request.staff!.userId);
    } catch (error) {
      return taxonomyError(reply, error);
    }
  });

  // Data Health (9.6, ANL-11): admins own integrations; marketing managers see whether numbers are fresh.
  app.get('/api/analytics/health', { preHandler: managers }, async () => health.report());

  app.post('/api/analytics/pipeline/:source/rerun', { preHandler: admin }, async (request, reply) => {
    const { source } = request.params as { source: string };
    if (!pipeline.sourceNames().includes(source) && !source.startsWith('ads_csv:'))
      return reply.code(404).send({ error: 'not_found', message: 'Unknown source' });
    const body = rerunBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message, field: body.error.issues[0]?.path.join('.') });
    const range = { from: body.data.from, to: body.data.to };
    if (body.data.mode === 'pull' && source.startsWith('ads_csv:')) return reply.code(400).send({ error: 'invalid_request', message: 'CSV uploads can only be rebuilt', field: 'mode' });
    try {
      return body.data.mode === 'rebuild' ? await pipeline.rebuild(source, range) : await pipeline.pull(source, range);
    } catch (error) {
      return reply.code(502).send({ error: 'source_failed', message: (error as Error).message });
    }
  });

  app.post('/api/analytics/ad-spend/csv', { preHandler: managers, bodyLimit: 6_000_000 }, async (request, reply) => {
    const body = csvBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message, field: body.error.issues[0]?.path.join('.') });
    try {
      return await pipeline.importAdCsv(body.data.platform, body.data.csv);
    } catch (error) {
      if (error instanceof CsvRowError) return reply.code(422).send({ error: 'invalid_rows', message: error.message, rows: error.errors });
      throw error;
    }
  });
}
