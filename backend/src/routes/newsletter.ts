import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { LANGUAGES } from '../contacts/fields.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { NewsletterError, type NewsletterService } from '../newsletter/service.js';

const idParams = z.object({ id: z.uuid() });
const cadenceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    sendDay: z.number().int().min(1).max(28),
    sendHour: z.number().int().min(0).max(23),
    collectWorkingDays: z.number().int().min(1).max(15),
    languages: z.array(z.enum(LANGUAGES)).min(1).max(3),
    segments: z.partialRecord(z.enum(LANGUAGES), z.uuid()),
    active: z.boolean(),
  })
  .strict();

export function newsletterError(reply: FastifyReply, error: unknown) {
  if (error instanceof NewsletterError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid_field' ? 400 : 409;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

/** Newsletter schedule and issues (NWS-01 to NWS-03, NWS-06). Editors work on drafts; managers own the schedule. */
export async function newsletterRoutes(app: FastifyInstance, { newsletter, coreEngine }: { newsletter: NewsletterService; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canEdit = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const managers = requireRole(coreEngine, ['marketing_manager', 'admin']);
  const withId = (handler: (id: string, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    try {
      return await handler(params.data.id, request, reply);
    } catch (error) {
      return newsletterError(reply, error);
    }
  };

  app.get('/api/newsletter/cadences', { preHandler: canEdit }, async () => ({ cadences: await newsletter.cadences() }));
  app.post('/api/newsletter/cadences', { preHandler: managers }, async (request, reply) => {
    const body = cadenceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      const cadence = await newsletter.saveCadence(body.data);
      await newsletter.schedule();
      return reply.code(201).send(cadence);
    } catch (error) {
      return newsletterError(reply, error);
    }
  });
  app.put('/api/newsletter/cadences/:id', { preHandler: managers }, withId(async (id, request, reply) => {
    const body = cadenceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    const cadence = await newsletter.saveCadence(body.data, id);
    await newsletter.schedule();
    return cadence;
  }));

  app.get('/api/newsletter/issues', { preHandler: canEdit }, async () => ({ issues: await newsletter.list() }));
  app.get('/api/newsletter/issues/:id', { preHandler: canEdit }, withId(async (id) => {
    const issue = await newsletter.require(id);
    const [blocks, items] = await Promise.all([newsletter.blocks(id), newsletter.items(issue)]);
    const used = new Set(blocks.flatMap((block) => block.itemIds));
    return { issue, blocks, items: items.map((item) => ({ ...item, used: used.has(item.id) })) };
  }));
  // Collect now instead of waiting for the scheduled moment, or redraft after sources changed.
  app.post('/api/newsletter/issues/:id/collect', { preHandler: canEdit }, withId(async (id) => newsletter.collectAndDraft(id)));
}
