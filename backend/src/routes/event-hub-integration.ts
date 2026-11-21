import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiKey } from '../auth/api-key.js';
import { requireRole } from '../auth/staff.js';
import type { EventHubIntegration } from '../eventhub/integration.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { rateLimit } from '../public/rate-limit.js';
import type { SegmentService } from '../segments/service.js';

const idParams = z.object({ id: z.string().uuid() });
const checkBody = z.object({ emails: z.array(z.string().trim().min(3).max(320)).min(1).max(1000) });

/** Marketing Hub → Event Hub (PRD 10.2, EVT-07). Contract: backend/docs/event-hub-contract.md. */
export async function eventHubIntegrationRoutes(
  app: FastifyInstance,
  { integration, segments, apiKey, coreEngine }: { integration: EventHubIntegration; segments: Pick<SegmentService, 'shareWithEventHub'>; apiKey: string | null; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> },
) {
  const service = { preHandler: [rateLimit({ max: 120, windowMs: 60_000 }), requireApiKey(apiKey, 'EVENT_HUB_API_KEY')] };

  app.get('/api/integrations/event-hub/segments', service, async () => ({ segments: await integration.sharedSegments() }));

  app.get('/api/integrations/event-hub/segments/:id/invitees', service, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const result = params.success ? await integration.invitees(params.data.id) : null;
    return result ?? reply.code(404).send({ error: 'not_found', message: 'Unknown segment, or not shared with Event Hub' });
  });

  app.post('/api/integrations/event-hub/suppression-check', service, async (request, reply) => {
    const body = checkBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message, field: 'emails' });
    return { suppressed: [...(await integration.suppressed(body.data.emails))] };
  });

  app.get('/api/integrations/event-hub/consent-wordings', service, async () => ({ wordings: integration.consentWordings() }));

  // Staff: a marketing manager decides which segments Event Hub may use for invitations.
  const managers = requireRole(coreEngine, ['admin', 'marketing_manager']);
  app.put('/api/audience/segments/:id/event-hub', { preHandler: managers }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = z.object({ shared: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'shared must be true or false', field: 'shared' });
    const segment = params.success ? await segments.shareWithEventHub(params.data.id, body.data.shared) : null;
    return segment ?? reply.code(404).send({ error: 'not_found', message: 'Unknown segment' });
  });
}
