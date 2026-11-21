import { createHash, timingSafeEqual } from 'node:crypto';
import type { preHandlerAsyncHookHandler } from 'fastify';

/** Compares hashes so neither the length nor the content of the key leaks through timing. */
export const sameKey = (given: string, expected: string) =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());

/**
 * Service-to-service access with an `x-api-key` header (Command Center, Event Hub). Staff tokens do not open
 * these endpoints; an unset key answers 503 so a missing configuration is visible.
 */
export function requireApiKey(key: string | null, name: string): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (!key) return reply.code(503).send({ error: 'not_configured', message: `${name} is not set` });
    const given = request.headers['x-api-key'];
    if (typeof given !== 'string' || !sameKey(given, key)) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or wrong x-api-key' });
  };
}
