import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { TOPICS } from '../consent/wordings.js';
import { LANGUAGES } from '../contacts/fields.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import type { KillSwitch } from '../sends/kill-switch.js';
import { SendError, type SendService } from '../sends/service.js';

const idParams = z.object({ id: z.uuid() });
const sendBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    kind: z.enum(['campaign', 'reengagement']).optional(),
    topic: z.enum(TOPICS),
    purpose: z.enum(['recruitment', 'other']).optional(),
    includeActiveAdmissions: z.boolean().optional(),
    segmentId: z.uuid().nullable(),
    language: z.enum(LANGUAGES),
    fromName: z.string().trim().min(1).max(100),
    fromAddress: z.string().trim().max(254),
    subject: z.string().trim().min(1).max(200),
    preheader: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(50_000),
    buttonLabel: z.string().max(60).nullable().optional(),
    buttonUrl: z.string().max(2000).nullable().optional(),
    utmCampaign: z.string().max(60).nullable().optional(),
  })
  .strict();
const approveBody = z.object({ scheduledAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict();
const pauseBody = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
const testBody = z.object({ emails: z.array(z.email()).min(1).max(20).optional() }).strict();
const logQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0), status: z.string().max(20).optional() });
const killBody = z.object({ paused: z.boolean(), reason: z.string().trim().max(300).nullable().optional() }).strict();

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof SendError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid_field' ? 400 : 409;
    return reply.code(status).send({ error: error.code, field: error.field ?? null, message: error.message });
  }
  throw error;
}

type SendRoutesOptions = { sends: SendService; killSwitch: KillSwitch; seedList: string[]; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken' | 'writeActivityLog'> };

/**
 * Campaign editor (PRD 13.6, Flow B): editors write and test; marketing managers and admins approve, schedule,
 * pause and cancel (PRD 4.3). The kill switch (EML-14) is theirs too.
 */
export async function sendRoutes(app: FastifyInstance, { sends, killSwitch, seedList, coreEngine }: SendRoutesOptions) {
  const canEdit = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const canApprove = requireRole(coreEngine, ['marketing_manager', 'admin']);
  const log = async (actorId: string, action: string, subjectId: string, reason?: string) => {
    try {
      await coreEngine.writeActivityLog({ actorId, action, subjectType: 'send', subjectId, reason, occurredAt: new Date().toISOString() });
    } catch (error) {
      app.log.error({ err: error }, 'activity log write failed');
    }
  };
  const withId = (handler: (id: string, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Send not found' });
      try {
        return await handler(params.data.id, request, reply);
      } catch (error) {
        return sendError(reply, error);
      }
    };

  app.get('/api/email/kill-switch', { preHandler: canEdit }, async () => killSwitch.state());
  app.put('/api/email/kill-switch', { preHandler: canApprove }, async (request, reply) => {
    const body = killBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Send {"paused": true|false, "reason": "..."}' });
    const state = await killSwitch.set(body.data.paused, request.staff!.userId, body.data.reason ?? null);
    await log(request.staff!.userId, body.data.paused ? 'sending.paused_all' : 'sending.resumed_all', 'kill_switch', body.data.reason ?? undefined);
    return state;
  });

  app.get('/api/email/sends', { preHandler: canEdit }, async () => ({ sends: await sends.list(), seedList }));

  app.post('/api/email/sends', { preHandler: canEdit }, async (request, reply) => {
    const body = sendBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', field: body.error.issues[0]?.path[0] ?? null, message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      return reply.code(201).send(await sends.create(body.data, request.staff!.userId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/api/email/sends/:id', { preHandler: canEdit }, withId(async (id) => sends.require(id)));
  app.put(
    '/api/email/sends/:id',
    { preHandler: canEdit },
    withId(async (id, request, reply) => {
      const body = sendBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', field: body.error.issues[0]?.path[0] ?? null, message: body.error.issues[0]?.message ?? 'Invalid request' });
      return sends.update(id, body.data);
    }),
  );
  app.delete('/api/email/sends/:id', { preHandler: canEdit }, withId(async (id, _request, reply) => {
    await sends.remove(id);
    return reply.code(204).send();
  }));
  app.get('/api/email/sends/:id/preview', { preHandler: canEdit }, withId(async (id) => sends.preview(id)));
  app.get('/api/email/sends/:id/checks', { preHandler: canEdit }, withId(async (id) => ({ checks: await sends.checks(id) })));
  app.post(
    '/api/email/sends/:id/test',
    { preHandler: canEdit },
    withId(async (id, request, reply) => {
      const body = testBody.safeParse(request.body ?? {});
      const recipients = (body.success && body.data.emails) || seedList;
      if (recipients.length === 0) return reply.code(400).send({ error: 'invalid_request', message: 'No seed list: set SEED_LIST or enter test addresses' });
      return sends.testSend(id, recipients);
    }),
  );
  app.post(
    '/api/email/sends/:id/approve',
    { preHandler: canApprove },
    withId(async (id, request, reply) => {
      const body = approveBody.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'scheduledAt must be an ISO date-time' });
      const approved = await sends.approve(id, request.staff!.userId, body.data.scheduledAt ? new Date(body.data.scheduledAt) : null);
      await log(request.staff!.userId, 'send.approved', id);
      return approved;
    }),
  );
  app.post(
    '/api/email/sends/:id/pause',
    { preHandler: canApprove },
    withId(async (id, request, reply) => {
      const body = pauseBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_field', field: 'reason', message: 'Give a reason' });
      return sends.pause(id, body.data.reason);
    }),
  );
  app.post('/api/email/sends/:id/resume', { preHandler: canApprove }, withId(async (id) => sends.resume(id)));
  app.post('/api/email/sends/:id/cancel', { preHandler: canApprove }, withId(async (id, request) => {
    const cancelled = await sends.cancel(id);
    await log(request.staff!.userId, 'send.cancelled', id);
    return cancelled;
  }));
  app.get('/api/email/sends/:id/report', { preHandler: canEdit }, withId(async (id) => sends.report(id)));
  app.get(
    '/api/email/sends/:id/log',
    { preHandler: canEdit },
    withId(async (id, request, reply) => {
      const query = logQuery.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: 'Bad paging' });
      return sends.log(id, query.data);
    }),
  );
}
