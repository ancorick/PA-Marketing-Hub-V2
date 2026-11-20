import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ConsentService } from '../consent/service.js';
import { TOPICS, type Topic } from '../consent/wordings.js';
import { FREQUENCIES, LANGUAGES } from '../contacts/fields.js';
import type { ContactRepository } from '../contacts/repository.js';
import { InvalidLinkError, type LinkPurpose, type LinkSigner } from '../links/tokens.js';
import { rateLimit } from '../public/rate-limit.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { deliveries } from '../db/schema.js';

type PublicPreferencesOptions = {
  consent: ConsentService;
  contacts: Pick<ContactRepository, 'findById' | 'update'>;
  signer: LinkSigner;
  db: AppPgDatabase;
};

const tokenQuery = z.object({ t: z.string().min(10).max(1000) });
const preferencesBody = z
  .object({
    topics: z.array(z.enum(TOPICS)).max(TOPICS.length),
    language: z.enum(LANGUAGES),
    frequency: z.enum(FREQUENCIES),
  })
  .strict();

/** "anna@example.test" → "a•••@example.test": enough for the person to recognise, useless to anyone else. */
export const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

const PERSON = { kind: 'person' } as const;

/**
 * Public pages without a password (AUD-09, AUD-11, Flow E). Every request carries a signed, expiring token
 * (NFR-S5) and is rate-limited (NFR-S6). Answers never include the full email address.
 */
export async function publicPreferenceRoutes(app: FastifyInstance, { consent, contacts, signer, db }: PublicPreferencesOptions) {
  const limited = rateLimit({ max: 30, windowMs: 60_000 });

  async function contactFor(request: FastifyRequest, reply: FastifyReply, purpose: LinkPurpose) {
    const query = tokenQuery.safeParse(request.query);
    if (!query.success) {
      await reply.code(400).send({ error: 'invalid_link', message: 'This link is not valid' });
      return null;
    }
    try {
      const { contactId, ref } = signer.verify(query.data.t, purpose);
      return { contactId, ref, contact: await contacts.findById(contactId) };
    } catch (error) {
      if (!(error instanceof InvalidLinkError)) throw error;
      await reply
        .code(error.expired ? 410 : 400)
        .send({ error: error.expired ? 'link_expired' : 'invalid_link', message: error.message });
      return null;
    }
  }

  async function preferencesView(contactId: string) {
    const contact = await contacts.findById(contactId);
    if (!contact || contact.status === 'erased' || !contact.email) return null;
    const [current, suppressed] = await Promise.all([consent.current(contactId), consent.isSuppressed(contact.email)]);
    return {
      email: maskEmail(contact.email),
      language: contact.language,
      frequency: contact.frequency,
      // Only an explicit yes counts as subscribed; unknown and pending are shown unticked.
      topics: TOPICS.filter((topic) => current[topic] === 'granted'),
      suppressed,
    };
  }

  // RFC 8058: mail clients POST "List-Unsubscribe=One-Click" as a form; our own page posts JSON or nothing.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post('/api/public/unsubscribe', { preHandler: limited }, async (request, reply) => {
    const found = await contactFor(request, reply, 'unsubscribe');
    if (!found) return reply;
    const { contactId, contact } = found;
    // Already erased or gone: nothing to send to, and the answer must not reveal which.
    if (contact && contact.status !== 'erased') {
      const oneClick = (request.body as Record<string, unknown> | undefined)?.['List-Unsubscribe'] === 'One-Click';
      await consent.unsubscribeAll(contactId, oneClick ? 'list_unsubscribe' : 'link', PERSON, { ip: request.ip });
      // Counts in the campaign report (NWS-13) when the link came from a send.
      if (found.ref) {
        await db
          .update(deliveries)
          .set({ unsubscribedAt: new Date() })
          .where(and(eq(deliveries.sendId, found.ref), eq(deliveries.contactId, contactId), isNull(deliveries.unsubscribedAt)));
      }
    }
    return {
      unsubscribed: true,
      language: contact?.language ?? 'hy',
      // Lets the confirmation page offer "Change preferences" without another email.
      preferencesToken: contact ? signer.sign(contactId, 'preferences') : null,
    };
  });

  // "Unsubscribe from all" on the preferences page (AUD-11), with the preferences token.
  app.post('/api/public/preferences/unsubscribe', { preHandler: limited }, async (request, reply) => {
    const found = await contactFor(request, reply, 'preferences');
    if (!found) return reply;
    if (found.contact && found.contact.status !== 'erased') {
      await consent.unsubscribeAll(found.contactId, 'preferences', PERSON, { ip: request.ip });
    }
    return (await preferencesView(found.contactId)) ?? { unsubscribed: true };
  });

  app.post('/api/public/unsubscribe/undo', { preHandler: limited }, async (request, reply) => {
    const found = await contactFor(request, reply, 'unsubscribe');
    if (!found) return reply;
    if (!found.contact || found.contact.status === 'erased') return reply.code(404).send({ error: 'not_found', message: 'Nothing to undo' });
    await consent.undoUnsubscribe(found.contactId);
    return { unsubscribed: false };
  });

  app.get('/api/public/preferences', { preHandler: limited }, async (request, reply) => {
    const found = await contactFor(request, reply, 'preferences');
    if (!found) return reply;
    return (await preferencesView(found.contactId)) ?? reply.code(404).send({ error: 'not_found', message: 'These preferences no longer exist' });
  });

  app.put('/api/public/preferences', { preHandler: limited }, async (request, reply) => {
    const found = await contactFor(request, reply, 'preferences');
    if (!found) return reply;
    const { contactId, contact } = found;
    if (!contact || contact.status === 'erased') return reply.code(404).send({ error: 'not_found', message: 'These preferences no longer exist' });
    const body = preferencesBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: 'Choose topics, a language and a frequency' });

    const current = await consent.current(contactId);
    const wanted = new Set<Topic>(body.data.topics);
    const grant = TOPICS.filter((topic) => wanted.has(topic) && current[topic] !== 'granted');
    const withdraw = TOPICS.filter((topic) => !wanted.has(topic) && (current[topic] === 'granted' || current[topic] === 'pending'));
    const meta = { method: 'link' as const, ip: request.ip, sourceUrl: 'preferences page' };
    if (grant.length > 0) await consent.record(contactId, { ...meta, topics: grant, state: 'granted' }, PERSON);
    if (withdraw.length > 0) await consent.record(contactId, { ...meta, topics: withdraw, state: 'withdrawn' }, PERSON);
    const changes = {
      ...(body.data.language !== contact.language && { language: body.data.language }),
      ...(body.data.frequency !== contact.frequency && { frequency: body.data.frequency }),
    };
    if (Object.keys(changes).length > 0) await contacts.update(contactId, changes, 'person');
    return preferencesView(contactId);
  });
}
