import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { CoreEngineClient, StaffRole, StaffSession } from '../integrations/core-engine/contract.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Signed-in staff member; set by requireRole before the handler runs. */
    staff: StaffSession | null;
  }
}

export function registerStaffAuth(app: FastifyInstance) {
  app.decorateRequest('staff', null);
}

/**
 * NFR-S1: staff sign in through the Core Engine; the role check runs on the API, not only in the UI.
 * Expects "Authorization: Bearer <token>". 401 without a valid session, 403 without one of the roles.
 */
export function requireRole(
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>,
  roles: readonly StaffRole[],
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const match = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
    const session = match?.[1] ? await coreEngine.verifyStaffToken(match[1]) : null;
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Sign in to continue' });
    }
    if (!session.roles.some((role) => roles.includes(role))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Your role does not allow this action' });
    }
    request.staff = session;
  };
}
