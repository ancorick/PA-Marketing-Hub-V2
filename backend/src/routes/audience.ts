import type { FastifyInstance } from 'fastify';
import type { AudienceInsights } from '../audience/insights.js';
import { requireRole } from '../auth/staff.js';
import type { CoreEngineClient, StaffSession } from '../integrations/core-engine/contract.js';

/** Marketing roles see exact numbers; everyone else gets small numbers hidden (ANL-14, NFR-P5). */
const isShared = (staff: StaffSession | null) => !staff?.roles.some((role) => role === 'editor' || role === 'marketing_manager' || role === 'admin');

/** Audience aggregates (RESTRUCTURE R4): the Contacts metric strip and Audience health. Counts only, every staff role. */
export async function audienceRoutes(app: FastifyInstance, { insights, coreEngine }: { insights: AudienceInsights; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const anyStaff = requireRole(coreEngine, ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']);
  app.get('/api/audience/summary', { preHandler: anyStaff }, async (request) => insights.summary(isShared(request.staff)));
  app.get('/api/audience/health', { preHandler: anyStaff }, async (request) => insights.health(isShared(request.staff)));
}
