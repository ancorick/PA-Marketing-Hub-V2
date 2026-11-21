import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CsvRowError, type AnalyticsPipeline } from '../analytics/pipeline.js';
import { requireRole } from '../auth/staff.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rerunBody = z
  .object({ from: day, to: day, mode: z.enum(['pull', 'rebuild']).default('pull') })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 400 * 86_400_000, { message: 'At most 400 days at a time', path: ['to'] });
const csvBody = z.object({ platform: z.enum(['meta_ads', 'google_ads']), csv: z.string().min(1).max(5_000_000) });

/** Analytics pipeline (PRD 9.1, 9.2): re-runs of a date range (admin) and the ad spend CSV fallback. */
export async function analyticsRoutes(app: FastifyInstance, { pipeline, coreEngine }: { pipeline: AnalyticsPipeline; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const admin = requireRole(coreEngine, ['admin']);
  const costs = requireRole(coreEngine, ['admin', 'marketing_manager']);

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

  app.post('/api/analytics/ad-spend/csv', { preHandler: costs, bodyLimit: 6_000_000 }, async (request, reply) => {
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
