import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { DmarcReportError, type DmarcService } from '../dmarc/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/**
 * DMARC reports (EML-07) on the Email settings screen: admins upload the report files (XML or .gz);
 * admins and marketing managers see the sources and the alignment pass rate (M6).
 */
export async function dmarcRoutes(app: FastifyInstance, { dmarc, coreEngine }: { dmarc: DmarcService; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canView = requireRole(coreEngine, ['admin', 'marketing_manager']);
  const canUpload = requireRole(coreEngine, ['admin']);

  // The file arrives as the raw request body, whatever its type.
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (_request, body, done) => done(null, body));

  app.post('/api/email/dmarc-reports', { preHandler: canUpload }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Upload the report file as the request body' });
    }
    try {
      return reply.code(201).send(await dmarc.ingest(request.body, request.staff!.userId));
    } catch (error) {
      if (error instanceof DmarcReportError) return reply.code(400).send({ error: 'invalid_report', message: error.message });
      throw error;
    }
  });

  app.get('/api/email/dmarc-reports/summary', { preHandler: canView }, async (request, reply) => {
    const query = summaryQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: 'days must be 1 to 365' });
    return dmarc.summary(query.data.days);
  });
}
