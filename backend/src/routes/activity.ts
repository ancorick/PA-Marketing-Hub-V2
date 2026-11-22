import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ActivityLog } from '../admin/activity.js';
import { requireRole } from '../auth/staff.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const query = z.object({
  action: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Activity log for the Admin page: admins and marketing managers, like the export log (AUD-19). */
export async function activityRoutes(app: FastifyInstance, { activity, coreEngine }: { activity: ActivityLog; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const managers = requireRole(coreEngine, ['marketing_manager', 'admin']);
  app.get('/api/admin/activity', { preHandler: managers }, async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', message: 'Check action, limit and offset' });
    return activity.list(parsed.data);
  });
}
