import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TOPICS } from '../consent/wordings.js';
import { LANGUAGES, ContactFieldError } from '../contacts/fields.js';
import { InvalidLinkError } from '../links/tokens.js';
import { rateLimit } from '../public/rate-limit.js';
import type { SignupService } from '../signup/service.js';

const optional = (max: number) => z.string().max(max).nullable().optional();

/** The documented sign-up contract (AUD-20): backend/docs/signup-endpoint.md. */
const signupBody = z
  .object({
    email: z.string().max(320),
    firstName: optional(100),
    lastName: optional(100),
    language: z.enum(LANGUAGES),
    consent: z.array(z.object({ topic: z.enum(TOPICS), wordingVersion: z.string().max(60) })).max(TOPICS.length),
    pageUrl: optional(2000),
    utmSource: optional(200),
    utmMedium: optional(200),
    utmCampaign: optional(200),
    courseInterest: optional(200),
    wantsToApply: z.boolean().optional(),
    form: z.enum(['website', 'social_lead_form']).default('website'),
    /** Honeypot (NFR-S6): hidden from people with CSS; bots fill every field. Must stay empty. */
    website: z.string().max(500).optional(),
  })
  .strict();

const tokenQuery = z.object({ t: z.string().min(10).max(1000) });

/** One answer for new and known addresses, so the form cannot be used to test who is on the list. */
const ACCEPTED = { status: 'check_your_inbox', message: 'If the address is valid, a confirmation email is on its way' } as const;

export async function publicSignupRoutes(app: FastifyInstance, { signup }: { signup: SignupService }) {
  const limited = rateLimit({ max: 10, windowMs: 60_000 });

  app.post('/api/public/signup', { preHandler: limited }, async (request, reply) => {
    const body = signupBody.safeParse(request.body);
    if (!body.success) {
      const issue = body.error.issues[0];
      return reply.code(400).send({ error: 'invalid_request', field: issue?.path[0] ?? null, message: issue?.message ?? 'Invalid request' });
    }
    const { website, ...input } = body.data;
    if (website) {
      request.log.info({ ip: request.ip }, 'sign-up honeypot filled; dropped');
      return reply.code(202).send(ACCEPTED);
    }
    try {
      await signup.signUp(input, { ip: request.ip });
    } catch (error) {
      if (error instanceof ContactFieldError) return reply.code(400).send({ error: 'invalid_field', field: error.field, message: error.message });
      throw error;
    }
    return reply.code(202).send(ACCEPTED);
  });

  app.post('/api/public/confirm', { preHandler: limited }, async (request, reply) => {
    const query = tokenQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_link', message: 'This link is not valid' });
    try {
      return { confirmed: true, ...(await signup.confirm(query.data.t)) };
    } catch (error) {
      if (error instanceof InvalidLinkError) {
        return reply.code(error.expired ? 410 : 400).send({ error: error.expired ? 'link_expired' : 'invalid_link', message: error.message });
      }
      if (error instanceof ContactFieldError) return reply.code(404).send({ error: 'not_found', message: error.message });
      throw error;
    }
  });
}
