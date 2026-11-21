import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ATTRIBUTION_MODELS } from '../analytics/attribution.js';
import type { DetailService } from '../analytics/detail.js';
import type { OverviewService } from '../analytics/overview.js';
import { rateLimit } from '../public/rate-limit.js';

export const COMMAND_CENTER_CONTRACT_VERSION = 'v1';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const query = z
  .object({ from: day, to: day, model: z.enum(ATTRIBUTION_MODELS).default('first_touch') })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 800 * 86_400_000, { message: 'At most 24 months at a time', path: ['to'] });

/** Compares hashes so neither the length nor the content of the key leaks through timing. */
const sameKey = (given: string, expected: string) =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());

/**
 * Aggregate metrics for Command Center, Project 15 (ANL-13, Flow D step 5). Service-to-service with an API key;
 * the same numbers leadership sees: aggregates only, counts of 1 or 2 people hidden (ANL-14, NFR-P5).
 * Contract: backend/docs/command-center-api.md.
 */
export async function commandCenterRoutes(app: FastifyInstance, { overview, detail, apiKey }: { overview: OverviewService; detail: DetailService; apiKey: string | null }) {
  app.get('/api/v1/command-center/metrics', { preHandler: rateLimit({ max: 60, windowMs: 60_000 }) }, async (request, reply) => {
    if (!apiKey) return reply.code(503).send({ error: 'not_configured', message: 'COMMAND_CENTER_API_KEY is not set' });
    const given = request.headers['x-api-key'];
    if (typeof given !== 'string' || !sameKey(given, apiKey)) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or wrong x-api-key' });
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', message: parsed.error.issues[0]?.message, field: parsed.error.issues[0]?.path.join('.') });
    const { from, to, model } = parsed.data;
    const [summary, cohorts] = await Promise.all([overview.overview({ from, to }, model, true), detail.cohorts(model, true)]);
    return {
      contractVersion: COMMAND_CENTER_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      period: summary.period,
      model: summary.model,
      modelLabel: summary.modelLabel,
      lookbackDays: 365,
      currency: 'AMD',
      tiles: summary.tiles,
      channels: summary.channels,
      totals: summary.totals,
      cohorts: cohorts.cohorts,
      definitions: summary.definitions,
    };
  });
}
