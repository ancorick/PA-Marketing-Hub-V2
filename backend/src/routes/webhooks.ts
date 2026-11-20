import type { FastifyInstance } from 'fastify';
import { verifyWebhook, WebhookError } from '../email/webhooks.js';
import type { EspEventService } from '../events/service.js';

/**
 * ESP webhooks (EML-04): the raw body is verified against the signature before anything is parsed
 * (NFR-S4), then processed at once (NFR-F5: lag under a minute). 401 for bad signatures and replays.
 */
export async function webhookRoutes(app: FastifyInstance, { events, secret }: { events: EspEventService; secret: string | null }) {
  // The signature covers the exact bytes, so keep the body as a string in this plugin.
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));

  app.post('/api/webhooks/esp', async (request, reply) => {
    if (!secret) return reply.code(503).send({ error: 'not_configured', message: 'ESP_WEBHOOK_SECRET is not set' });
    try {
      const parsed = verifyWebhook(secret, request.headers['x-mh-signature'] as string | undefined, String(request.body ?? ''));
      return await events.process(parsed);
    } catch (error) {
      if (error instanceof WebhookError) {
        request.log.warn({ reason: error.reason }, 'ESP webhook rejected');
        return reply.code(error.reason === 'bad_payload' ? 400 : 401).send({ error: error.reason, message: error.message });
      }
      throw error;
    }
  });
}
