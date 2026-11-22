import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { LogEmailAdapter } from '../email/log-adapter.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const query = z.object({ to: z.string().max(200).optional() });
const params = z.object({ id: z.string().min(1).max(80) });

/**
 * Dev inbox (RESTRUCTURE §3, R5): the messages the log adapter kept instead of sending. Registered only outside
 * production and only while the log adapter is in use, so the page cannot expose mail in a real deployment.
 */
export async function devInboxRoutes(app: FastifyInstance, { adapter, coreEngine }: { adapter: LogEmailAdapter; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> }) {
  const canView = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);

  app.get('/api/dev/inbox', { preHandler: canView }, async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', message: 'Check the filter' });
    const needle = parsed.data.to?.trim().toLowerCase();
    const messages = [...adapter.inbox]
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .filter((entry) => !needle || entry.message.to.toLowerCase().includes(needle))
      .slice(0, 200)
      .map(({ id, receivedAt, message }) => ({ id, receivedAt: receivedAt.toISOString(), to: message.to, from: message.from, subject: message.subject, stream: message.stream }));
    return { messages, total: adapter.inbox.length };
  });

  app.get('/api/dev/inbox/:id', { preHandler: canView }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    const entry = parsed.success ? adapter.inbox.find((item) => item.id === parsed.data.id) : undefined;
    if (!entry) return reply.code(404).send({ error: 'not_found', message: 'Message not found' });
    const { id, receivedAt, message } = entry;
    return { id, receivedAt: receivedAt.toISOString(), to: message.to, from: message.from, replyTo: message.replyTo ?? null, subject: message.subject, stream: message.stream, headers: message.headers ?? {}, html: message.html, text: message.text };
  });
}
