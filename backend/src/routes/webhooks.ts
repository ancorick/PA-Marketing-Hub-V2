import type { FastifyInstance } from 'fastify';
import { verifySignedJson, verifyWebhook, WebhookError } from '../email/webhooks.js';
import { messageSchema } from '../eventhub/contract.js';
import type { EventHubService } from '../eventhub/service.js';
import type { EspEventService } from '../events/service.js';

/**
 * ESP webhooks (EML-04): the raw body is verified against the signature before anything is parsed
 * (NFR-S4), then processed at once (NFR-F5: lag under a minute). 401 for bad signatures and replays.
 */
export async function webhookRoutes(
  app: FastifyInstance,
  { events, secret, eventHub, eventHubSecret }: { events: EspEventService; secret: string | null; eventHub: EventHubService; eventHubSecret: string | null },
) {
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

  // Event Hub (PRD 10.3, EVT-02): one signed message per request; each idempotency key processed once.
  app.post('/api/webhooks/event-hub', async (request, reply) => {
    if (!eventHubSecret) return reply.code(503).send({ error: 'not_configured', message: 'EVENT_HUB_WEBHOOK_SECRET is not set' });
    try {
      const json = verifySignedJson(eventHubSecret, request.headers['x-eventhub-signature'] as string | undefined, String(request.body ?? ''));
      const message = messageSchema.safeParse(json);
      if (!message.success) {
        const issue = message.error.issues[0];
        return reply.code(400).send({ error: 'bad_payload', message: issue?.message ?? 'Invalid message', field: issue?.path.join('.') });
      }
      return await eventHub.process(message.data);
    } catch (error) {
      if (error instanceof WebhookError) {
        request.log.warn({ reason: error.reason }, 'Event Hub webhook rejected');
        return reply.code(error.reason === 'bad_payload' ? 400 : 401).send({ error: error.reason, message: error.message });
      }
      throw error;
    }
  });
}
