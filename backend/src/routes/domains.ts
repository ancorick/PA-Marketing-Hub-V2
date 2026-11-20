import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { DuplicateDomainError } from '../domains/repository.js';
import { InvalidDomainError, type DomainService } from '../domains/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

type DomainRoutesOptions = {
  domains: DomainService;
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>;
};

const idParams = z.object({ id: z.uuid() });
const addBody = z.object({ domain: z.string().max(253) });

const notFound = { error: 'not_found', message: 'Sending domain not found' } as const;

/**
 * Email settings → sending domains (PRD 13.6, EML-02, EML-03).
 * Managing domains is admin-only (PRD 4.3); marketing managers can see status and re-check DNS,
 * because the email settings screen is also theirs (warm-up, kill switch).
 */
export async function domainRoutes(app: FastifyInstance, { domains, coreEngine }: DomainRoutesOptions) {
  const canView = requireRole(coreEngine, ['admin', 'marketing_manager']);
  const canManage = requireRole(coreEngine, ['admin']);

  app.get('/api/email/domains', { preHandler: canView }, async () => ({ domains: await domains.list() }));

  app.post('/api/email/domains', { preHandler: canManage }, async (request, reply) => {
    const body = addBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Send {"domain": "news.academy-domain.am"}' });
    }
    try {
      const created = await domains.add(body.data.domain, { userId: request.staff!.userId });
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof InvalidDomainError) return reply.code(400).send({ error: 'invalid_domain', message: error.message });
      if (error instanceof DuplicateDomainError) {
        return reply.code(409).send({ error: 'domain_exists', message: `${error.domain} is already added` });
      }
      throw error;
    }
  });

  app.post('/api/email/domains/:id/verify', { preHandler: canView }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const verified = params.success ? await domains.verify(params.data.id) : null;
    return verified ?? reply.code(404).send(notFound);
  });

  app.delete('/api/email/domains/:id', { preHandler: canManage }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const removed = params.success && (await domains.remove(params.data.id, { userId: request.staff!.userId }));
    return removed ? reply.code(204).send() : reply.code(404).send(notFound);
  });
}
