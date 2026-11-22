import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import type { AudienceInsights } from '../audience/insights.js';
import { CHANNEL_IDS, CHANNELS, CONTACT_STATUSES, CONTACT_TYPES, ContactFieldError, LANGUAGES } from '../contacts/fields.js';
import { DuplicateContactError } from '../contacts/repository.js';
import { CoreEngineUnavailableError, type ContactService } from '../contacts/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

type ContactRoutesOptions = {
  contacts: ContactService;
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>;
};

const optionalText = (max: number) => z.string().max(max).nullable().optional();

/** "2026-11-01" is midnight in Yerevan, the Academy's calendar (like the warm-up day). */
const dateOrDateTime = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => new Date(value.length === 10 ? `${value}T00:00:00+04:00` : value));

const contactFields = {
  email: z.string().max(320),
  firstName: optionalText(100),
  lastName: optionalText(100),
  phone: optionalText(32),
  language: z.enum(LANGUAGES),
  type: z.enum(CONTACT_TYPES).optional(),
  sourceChannel: z.enum(CHANNEL_IDS),
  sourceCampaign: optionalText(100),
  firstTouchAt: dateOrDateTime.optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  corePersonId: z.string().trim().min(1).max(100).optional(),
};

const createBody = z.object(contactFields).strict();
const updateBody = z.object(contactFields).partial().strict();

const listQuery = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(CONTACT_TYPES).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  language: z.enum(LANGUAGES).optional(),
  tag: z
    .string()
    .max(60)
    .transform((tag) => tag.trim().replace(/^#/, '').toLowerCase())
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParams = z.object({ id: z.uuid() });

const notFound = { error: 'not_found', message: 'Contact not found' } as const;

function invalid(reply: FastifyReply, error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return reply.code(400).send({
    error: 'invalid_request',
    field: typeof field === 'string' ? field : null,
    message: issue ? `${typeof field === 'string' ? `${field}: ` : ''}${issue.message}` : 'Invalid request',
  });
}

/** Turns the contact rules into API answers; anything else is a 500. */
function sendKnownError(reply: FastifyReply, error: unknown) {
  if (error instanceof ContactFieldError) {
    return reply.code(400).send({ error: 'invalid_field', field: error.field, message: error.message });
  }
  if (error instanceof DuplicateContactError) {
    return reply
      .code(409)
      .send({ error: 'contact_exists', field: error.field, existingId: error.existingId, message: error.message });
  }
  if (error instanceof CoreEngineUnavailableError) {
    return reply.code(503).send({ error: 'core_engine_unavailable', message: error.message });
  }
  throw error;
}

/**
 * Audience → Contacts (PRD 13.6, AUD-01, AUD-02).
 * Individual contact records are for editors, marketing managers and admins; viewers and leadership
 * see aggregates only (PRD 4.3).
 */
export async function contactRoutes(app: FastifyInstance, { contacts, coreEngine, insights }: ContactRoutesOptions & { insights?: AudienceInsights }) {
  const canUseContacts = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);

  app.get('/api/audience/channels', { preHandler: canUseContacts }, async () => ({ channels: CHANNELS }));

  app.get('/api/audience/contacts', { preHandler: canUseContacts }, async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error);
    const { q, ...filter } = query.data;
    const page = await contacts.list({ ...filter, search: q });
    // Newsletter consent per row (RESTRUCTURE R4: the list shows it next to the status).
    const consent = insights ? await insights.newsletterStates(page.contacts.map((contact) => contact.id)) : new Map();
    return {
      ...page,
      contacts: page.contacts.map((contact) => ({ ...contact, newsletterConsent: consent.get(contact.id) ?? 'unknown' })),
      limit: filter.limit,
      offset: filter.offset,
    };
  });

  app.get('/api/audience/contacts/:id', { preHandler: canUseContacts }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const contact = params.success ? await contacts.get(params.data.id) : null;
    return contact ?? reply.code(404).send(notFound);
  });

  app.post('/api/audience/contacts', { preHandler: canUseContacts }, async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return reply.code(201).send(await contacts.create(body.data, { userId: request.staff!.userId }));
    } catch (error) {
      return sendKnownError(reply, error);
    }
  });

  app.patch('/api/audience/contacts/:id', { preHandler: canUseContacts }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    const body = updateBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      const updated = await contacts.update(params.data.id, body.data, { userId: request.staff!.userId });
      return updated ?? reply.code(404).send(notFound);
    } catch (error) {
      return sendKnownError(reply, error);
    }
  });
}
