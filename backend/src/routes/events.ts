import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { EventsView } from '../eventhub/events-view.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const period = z
  .object({ from: day, to: day })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 800 * 86_400_000, { message: 'At most 24 months at a time', path: ['to'] });

/** Events module (PRD 9.6, 10): the Events view for every staff role, aggregates only outside marketing. */
export async function eventRoutes(app: FastifyInstance, { view, coreEngine }: { view: EventsView; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const anyStaff = requireRole(coreEngine, ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']);

  app.get('/api/events', { preHandler: anyStaff }, async (request, reply) => {
    const query = period.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: query.error.issues[0]?.message, field: query.error.issues[0]?.path.join('.') });
    const shared = !request.staff?.roles.some((role) => role === 'editor' || role === 'marketing_manager' || role === 'admin');
    return view.list(query.data, shared);
  });
}
