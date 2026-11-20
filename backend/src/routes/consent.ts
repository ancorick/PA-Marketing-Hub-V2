import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { ConsentRuleError, type ConsentService } from '../consent/service.js';
import { CONSENT_WORDINGS, TOPICS } from '../consent/wordings.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

type ConsentRoutesOptions = {
  consent: ConsentService;
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>;
};

const idParams = z.object({ id: z.uuid() });
const manualBody = z
  .object({
    topics: z.array(z.enum(TOPICS)).min(1),
    state: z.enum(['granted', 'withdrawn']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const unsubscribeBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

const notFound = { error: 'not_found', message: 'Contact not found' } as const;

function sendRuleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ConsentRuleError) {
    if (error.field === 'contactId') return reply.code(404).send({ error: 'not_found', message: error.message });
    return reply.code(400).send({ error: 'invalid_field', field: error.field, message: error.message });
  }
  throw error;
}

/**
 * Consent per contact (AUD-07) and the suppression list (AUD-12).
 * Editors read consent; only marketing managers and admins change it, always with a reason (PRD 4.3, 6.3).
 */
export async function consentRoutes(app: FastifyInstance, { consent, coreEngine }: ConsentRoutesOptions) {
  const canRead = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const canChange = requireRole(coreEngine, ['marketing_manager', 'admin']);

  app.get('/api/audience/consent-wordings', { preHandler: canRead }, async () => ({ wordings: CONSENT_WORDINGS }));

  app.get('/api/audience/suppressions/summary', { preHandler: canRead }, async () => ({ active: await consent.summary() }));

  app.get('/api/audience/contacts/:id/consent', { preHandler: canRead }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const view = params.success ? await consent.view(params.data.id) : null;
    return view ?? reply.code(404).send(notFound);
  });

  app.post('/api/audience/contacts/:id/consent', { preHandler: canChange }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    const body = manualBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Send {"topics": [...], "state": "granted" | "withdrawn", "reason": "..."}' });
    }
    try {
      await consent.record(params.data.id, { ...body.data, method: 'manual' }, { kind: 'staff', userId: request.staff!.userId });
      return await consent.view(params.data.id);
    } catch (error) {
      return sendRuleError(reply, error);
    }
  });

  app.post('/api/audience/contacts/:id/unsubscribe', { preHandler: canChange }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    const body = unsubscribeBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_field', field: 'reason', message: 'Give a reason' });
    try {
      await consent.unsubscribeAll(params.data.id, 'manual', { kind: 'staff', userId: request.staff!.userId }, { reason: body.data.reason });
      return await consent.view(params.data.id);
    } catch (error) {
      return sendRuleError(reply, error);
    }
  });
}
