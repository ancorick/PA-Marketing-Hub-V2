import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { TOPICS } from '../consent/wordings.js';
import type { DuplicateService } from '../contacts/duplicates.js';
import { MergeError, type MergeService } from '../contacts/merge.js';
import { CHANNEL_IDS, ContactFieldError, LANGUAGES } from '../contacts/fields.js';
import type { ContactRepository } from '../contacts/repository.js';
import type { ContactService } from '../contacts/service.js';
import { IMPORT_FIELDS, type ImportService } from '../imports/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

type ImportRoutesOptions = {
  imports: ImportService;
  duplicates: DuplicateService;
  merge: MergeService;
  contacts: ContactService;
  contactRepository: Pick<ContactRepository, 'findById'>;
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>;
};

const importBody = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    csv: z.string().min(1),
    mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(200)).optional(),
    options: z
      .object({
        defaultLanguage: z.enum(LANGUAGES),
        defaultSourceChannel: z.enum(CHANNEL_IDS).optional(),
        sourceCampaign: z.string().max(100).nullable().optional(),
        tags: z.array(z.string().max(60)).max(10).optional(),
        consentTopic: z.enum(TOPICS).optional(),
      })
      .strict(),
  })
  .strict();

const dismissBody = z.object({ contactA: z.uuid(), contactB: z.uuid() }).strict();
const mergeBody = z.object({ otherId: z.uuid() }).strict();
const idParams = z.object({ id: z.uuid() });

function fieldError(reply: FastifyReply, error: unknown) {
  if (error instanceof ContactFieldError) return reply.code(400).send({ error: 'invalid_field', field: error.field, message: error.message });
  throw error;
}

/** CSV import (AUD-03) and duplicate review (AUD-04): editors, marketing managers and admins (PRD 4.3). */
export async function importRoutes(app: FastifyInstance, { imports, duplicates, merge, contacts, contactRepository, coreEngine }: ImportRoutesOptions) {
  const canUse = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  // 10,000 rows (NFR-F7) of a typical export fit well under 10 MB.
  const bodyLimit = 10 * 1024 * 1024;

  app.post('/api/audience/imports/preview', { preHandler: canUse, bodyLimit }, async (request, reply) => {
    const body = importBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      return await imports.preview(body.data.csv, body.data.mapping, body.data.options);
    } catch (error) {
      return fieldError(reply, error);
    }
  });

  app.post('/api/audience/imports', { preHandler: canUse, bodyLimit }, async (request, reply) => {
    const body = importBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      const result = await imports.commit(body.data.fileName, body.data.csv, body.data.mapping, body.data.options, request.staff!.userId);
      return reply.code(201).send(result);
    } catch (error) {
      return fieldError(reply, error);
    }
  });

  app.get('/api/audience/imports', { preHandler: canUse }, async () => ({ imports: await imports.list() }));

  app.get('/api/audience/duplicates', { preHandler: canUse }, async () => {
    const pairs = await duplicates.suggestions(50);
    const withContacts = await Promise.all(
      pairs.map(async (pair) => ({ reason: pair.reason, contacts: await Promise.all(pair.contactIds.map((id) => contacts.get(id))) })),
    );
    return { pairs: withContacts.filter((pair) => pair.contacts.every(Boolean)) };
  });

  app.get('/api/audience/contacts/:id/duplicates', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const contact = params.success ? await contactRepository.findById(params.data.id) : null;
    if (!contact) return reply.code(404).send({ error: 'not_found', message: 'Contact not found' });
    const found = await duplicates.forContact(contact);
    return {
      duplicates: (await Promise.all(found.map(async (item) => ({ reason: item.reason, contact: await contacts.get(item.contactId) })))).filter(
        (item) => item.contact,
      ),
    };
  });

  app.post('/api/audience/duplicates/dismiss', { preHandler: canUse }, async (request, reply) => {
    const body = dismissBody.safeParse(request.body);
    if (!body.success || body.data.contactA === body.data.contactB) return reply.code(400).send({ error: 'invalid_request', message: 'Send two different contact IDs' });
    await duplicates.dismiss(body.data.contactA, body.data.contactB, request.staff!.userId);
    return reply.code(204).send();
  });

  // AUD-05: merge :otherId into :id (the record that stays).
  app.post('/api/audience/contacts/:id/merge', { preHandler: canUse }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const body = mergeBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Send {"otherId": "<contact to merge in>"}' });
    try {
      await merge.merge(params.data.id, body.data.otherId, request.staff!.userId);
      return await contacts.get(params.data.id);
    } catch (error) {
      if (error instanceof MergeError) {
        const status = error.code === 'not_found' ? 404 : error.code === 'core_conflict' ? 409 : 400;
        return reply.code(status).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
