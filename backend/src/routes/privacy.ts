import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { PrivacyError, type PrivacyService } from '../privacy/service.js';

const idParams = z.object({ id: z.uuid() });
const eraseBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/**
 * Timeline (AUD-16) for anyone who sees contact records; exports (AUD-19, NFR-P4) and erasure (AUD-18) for
 * marketing managers and admins only, as "Export contacts" and consent changes are in PRD 4.3.
 */
export async function privacyRoutes(app: FastifyInstance, { privacy, coreEngine }: { privacy: PrivacyService; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canRead = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const managers = requireRole(coreEngine, ['marketing_manager', 'admin']);
  const notFound = { error: 'not_found', message: 'Not found' } as const;

  app.get('/api/audience/contacts/:id/timeline', { preHandler: canRead }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const items = params.success ? await privacy.timeline(params.data.id) : null;
    return items ? { items } : reply.code(404).send(notFound);
  });

  app.post('/api/audience/contacts/:id/erase', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = eraseBody.safeParse(request.body);
    if (!params.success) return reply.code(404).send(notFound);
    if (!body.success) return reply.code(400).send({ error: 'invalid_field', field: 'reason', message: 'Give the reason, e.g. "Erasure request by email, 2026-11-21"' });
    try {
      await privacy.erase(params.data.id, request.staff!.userId, body.data.reason);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PrivacyError) return reply.code(error.code === 'not_found' ? 404 : 409).send({ error: error.code, message: error.message });
      throw error;
    }
  });

  app.get('/api/audience/contacts/:id/export', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    try {
      const data = await privacy.exportContact(params.data.id, request.staff!.userId);
      return reply.header('content-disposition', `attachment; filename="contact-${params.data.id}.json"`).send(data);
    } catch (error) {
      if (error instanceof PrivacyError) return reply.code(404).send(notFound);
      throw error;
    }
  });

  app.get('/api/audience/segments/:id/export', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const result = params.success ? await privacy.exportSegment(params.data.id, request.staff!.userId) : null;
    if (!result) return reply.code(404).send(notFound);
    const file = result.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'segment';
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}.csv`)
      .header('x-row-count', String(result.rows))
      .send(result.csv);
  });

  app.get('/api/admin/exports', { preHandler: managers }, async () => ({ exports: await privacy.exports() }));
}
