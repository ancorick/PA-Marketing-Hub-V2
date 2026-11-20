import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { TOPICS } from '../consent/wordings.js';
import type { ContactService } from '../contacts/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { SegmentError, type SegmentService } from '../segments/service.js';

const idParams = z.object({ id: z.uuid() });
const createBody = z
  .object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).nullable().optional(), type: z.enum(['dynamic', 'static']), rule: z.unknown().optional() })
  .strict();
const updateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).nullable().optional(), rule: z.unknown().optional() }).strict();
const ruleBody = z.object({ rule: z.unknown() }).strict();
const membersBody = z.object({ contactIds: z.array(z.uuid()).max(5000).optional(), emails: z.array(z.string().max(320)).max(5000).optional() }).strict();
const removeBody = z.object({ contactIds: z.array(z.uuid()).min(1).max(5000) }).strict();
const pageQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) });
const breakdownQuery = z.object({ topic: z.enum(TOPICS).optional(), excludeActiveAdmissions: z.enum(['true', 'false']).default('true') });

const notFound = { error: 'not_found', message: 'Segment not found' } as const;

function segmentError(reply: FastifyReply, error: unknown) {
  if (error instanceof SegmentError) return reply.code(error.field === 'segmentId' ? 404 : 400).send({ error: 'invalid_field', field: error.field, message: error.message });
  throw error;
}

const summary = (contact: { id: string; email: string | null; firstName: string | null; lastName: string | null; type: string; language: string; status: string }) => ({
  id: contact.id,
  email: contact.email,
  firstName: contact.firstName,
  lastName: contact.lastName,
  type: contact.type,
  language: contact.language,
  status: contact.status,
});

/** Segment builder and static lists (AUD-13 to AUD-15, AUD-17; PRD 13.6 "Segment builder"). */
export async function segmentRoutes(app: FastifyInstance, { segments, coreEngine }: { segments: SegmentService; contacts: ContactService; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canUse = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);

  app.get('/api/audience/segments', { preHandler: canUse }, async () => ({ segments: await segments.list() }));

  app.post('/api/audience/segments', { preHandler: canUse }, async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      return reply.code(201).send(await segments.create(body.data, request.staff!.userId));
    } catch (error) {
      return segmentError(reply, error);
    }
  });

  // Live count and a few example contacts while editing (AUD-14), without saving.
  app.post('/api/audience/segments/count', { preHandler: canUse }, async (request, reply) => {
    const body = ruleBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Send {"rule": {...}}' });
    try {
      const [count, sample] = await Promise.all([segments.countRule(body.data.rule), segments.previewRule(body.data.rule, 10)]);
      return { count, sample: sample.map(summary) };
    } catch (error) {
      return segmentError(reply, error);
    }
  });

  app.get('/api/audience/segments/:id', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const segment = params.success ? await segments.get(params.data.id) : null;
    return segment ?? reply.code(404).send(notFound);
  });

  app.patch('/api/audience/segments/:id', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = updateBody.safeParse(request.body);
    if (!params.success) return reply.code(404).send(notFound);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      return (await segments.update(params.data.id, body.data)) ?? reply.code(404).send(notFound);
    } catch (error) {
      return segmentError(reply, error);
    }
  });

  app.delete('/api/audience/segments/:id', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const removed = params.success && (await segments.remove(params.data.id));
    return removed ? reply.code(204).send() : reply.code(404).send(notFound);
  });

  app.get('/api/audience/segments/:id/members', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const page = pageQuery.safeParse(request.query);
    if (!params.success || !page.success) return reply.code(404).send(notFound);
    const result = await segments.members(params.data.id, page.data);
    return result ? { total: result.total, contacts: result.contacts.map(summary) } : reply.code(404).send(notFound);
  });

  app.post('/api/audience/segments/:id/members', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = membersBody.safeParse(request.body);
    if (!params.success) return reply.code(404).send(notFound);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Send {"emails": [...]} or {"contactIds": [...]}' });
    try {
      return await segments.addMembers(params.data.id, body.data, request.staff!.userId);
    } catch (error) {
      return segmentError(reply, error);
    }
  });

  app.delete('/api/audience/segments/:id/members', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = removeBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Send {"contactIds": [...]}' });
    return { removed: await segments.removeMembers(params.data.id, body.data.contactIds) };
  });

  // Who would receive a send to this segment now, and why the rest would not (Flow B step 5).
  app.get('/api/audience/segments/:id/breakdown', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const query = breakdownQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(404).send(notFound);
    const result = await segments.breakdown(params.data.id, { topic: query.data.topic, excludeActiveAdmissions: query.data.excludeActiveAdmissions === 'true' });
    return result ?? reply.code(404).send(notFound);
  });
}
