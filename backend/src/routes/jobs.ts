import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import type { JobRunner } from '../jobs/runner.js';

const nameParams = z.object({ name: z.string().regex(/^[a-z0-9_]{1,60}$/) });

/**
 * Scheduled jobs (PRD 14.4: monitoring and a manual re-run button). Marketing managers see the status;
 * only admins re-run, because integrations are an admin capability (PRD 4.3).
 */
export async function jobRoutes(app: FastifyInstance, { jobs, coreEngine }: { jobs: JobRunner; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canView = requireRole(coreEngine, ['admin', 'marketing_manager']);
  const canRun = requireRole(coreEngine, ['admin']);

  app.get('/api/admin/jobs', { preHandler: canView }, async () => ({ jobs: await jobs.status() }));

  app.get('/api/admin/jobs/:name/runs', { preHandler: canView }, async (request, reply) => {
    const params = nameParams.safeParse(request.params);
    if (!params.success || !jobs.has(params.data.name)) return reply.code(404).send({ error: 'not_found', message: 'Unknown job' });
    return { runs: await jobs.history(params.data.name) };
  });

  app.post('/api/admin/jobs/:name/run', { preHandler: canRun }, async (request, reply) => {
    const params = nameParams.safeParse(request.params);
    if (!params.success || !jobs.has(params.data.name)) return reply.code(404).send({ error: 'not_found', message: 'Unknown job' });
    return jobs.run(params.data.name, request.staff!.userId);
  });
}
