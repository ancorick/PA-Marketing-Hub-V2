import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AlertService } from '../alerts/service.js';
import { requireRole } from '../auth/staff.js';
import type { AppPgDatabase } from '../db/client.js';
import { contactImports } from '../db/schema.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const idParams = z.object({ id: z.uuid() });

/** Staff alerts (7.4, 14.4) and the review that unblocks a bounced import (7.4). */
export async function alertRoutes(app: FastifyInstance, { alerts, db, coreEngine }: { alerts: AlertService; db: AppPgDatabase; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const anyStaff = requireRole(coreEngine, ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']);
  const managers = requireRole(coreEngine, ['marketing_manager', 'admin']);

  // ?resolved=true adds the resolved alerts after the open ones (the Alerts page history).
  app.get('/api/alerts', { preHandler: anyStaff }, async (request) => {
    const role = request.staff!.roles[0]!;
    const resolved = (request.query as { resolved?: string }).resolved === 'true';
    return { alerts: await alerts.forRole(role, resolved) };
  });

  app.post('/api/alerts/:id/resolve', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const resolved = params.success ? await alerts.resolve(params.data.id, request.staff!.userId) : null;
    return resolved ?? reply.code(404).send({ error: 'not_found', message: 'Alert not found or already resolved' });
  });

  app.post('/api/audience/imports/:id/review', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Import not found' });
    const [row] = await db
      .update(contactImports)
      .set({ reviewedAt: new Date(), reviewedBy: request.staff!.userId })
      .where(and(eq(contactImports.id, params.data.id), isNull(contactImports.reviewedAt)))
      .returning();
    return row ?? reply.code(404).send({ error: 'not_found', message: 'Import not found or already reviewed' });
  });
}
