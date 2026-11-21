import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { EventsView } from '../eventhub/events-view.js';
import { manualEventSchema, ManualEventError, type ManualEvents } from '../eventhub/manual.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const period = z
  .object({ from: day, to: day })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 800 * 86_400_000, { message: 'At most 24 months at a time', path: ['to'] });

/** Events module (PRD 9.6, 10): the Events view for every staff role, aggregates only outside marketing. */
export async function eventRoutes(
  app: FastifyInstance,
  { view, manual, coreEngine }: { view: EventsView; manual: ManualEvents; coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'> },
) {
  const anyStaff = requireRole(coreEngine, ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']);
  // 10.5 fallback: the marketing team enters events and attendee lists (imports are contact data, 4.3).
  const marketing = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const idParams = z.object({ id: z.string().uuid() });
  const csvBody = z.object({ csv: z.string().min(1).max(3_000_000), attendedByDefault: z.boolean().default(true) });
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
    if (!(error instanceof ManualEventError)) throw error;
    const status = { not_found: 404, event_hub_owned: 409, invalid_rows: 422 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message, ...(error.rows.length && { rows: error.rows }) });
  };
  const invalid = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: z.ZodError) =>
    reply.code(400).send({ error: 'invalid_request', message: error.issues[0]?.message, field: error.issues[0]?.path.join('.') });

  app.post('/api/events', { preHandler: marketing }, async (request, reply) => {
    const body = manualEventSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    return reply.code(201).send(await manual.create(body.data));
  });

  app.put('/api/events/:id', { preHandler: marketing }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown event' });
    const body = manualEventSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return await manual.update(params.data.id, body.data);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/events/:id/attendees/csv', { preHandler: marketing, bodyLimit: 4_000_000 }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Unknown event' });
    const body = csvBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return await manual.importAttendees(params.data.id, body.data.csv, { attendedByDefault: body.data.attendedByDefault }, request.staff!.userId);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/events', { preHandler: anyStaff }, async (request, reply) => {
    const query = period.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: query.error.issues[0]?.message, field: query.error.issues[0]?.path.join('.') });
    const shared = !request.staff?.roles.some((role) => role === 'editor' || role === 'marketing_manager' || role === 'admin');
    return view.list(query.data, shared);
  });
}
