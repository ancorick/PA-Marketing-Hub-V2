import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CsvRowError, type AnalyticsPipeline } from '../analytics/pipeline.js';
import { RULE_KINDS, TaxonomyError, type ChannelTaxonomy } from '../analytics/taxonomy.js';
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
const csvBody = z.object({ platform: z.enum(['meta_ads', 'google_ads']), csv: z.string().min(1).max(5_000_000) });

/** Analytics pipeline (PRD 9.1, 9.2): re-runs of a date range (admin) and the ad spend CSV fallback. */
export async function analyticsRoutes(app: FastifyInstance, { pipeline, taxonomy, links, costs, coreEngine }: { pipeline: AnalyticsPipeline; taxonomy: ChannelTaxonomy; links: LinkBuilder; costs: CostService; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
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
