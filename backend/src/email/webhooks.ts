import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Normalized ESP events (EML-04). The real ESP adapter translates its provider's webhook into this shape;
 * until the ESP is chosen (PRD 16.3 question 1) this is also the wire format of /api/webhooks/esp.
 */
export const ESP_EVENT_TYPES = ['delivered', 'bounced', 'complained', 'opened', 'clicked', 'unsubscribed', 'account_warning'] as const;
export type EspEventType = (typeof ESP_EVENT_TYPES)[number];

export const espEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(ESP_EVENT_TYPES),
  messageId: z.string().max(200).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  bounceType: z.enum(['hard', 'soft']).optional(),
  url: z.string().max(2000).optional(),
  detail: z.string().max(1000).optional(),
});
export type EspEvent = z.infer<typeof espEventSchema>;

export const webhookBodySchema = z.object({ events: z.array(espEventSchema).min(1).max(1000) });

export class WebhookError extends Error {
  constructor(
    readonly reason: 'missing_signature' | 'bad_signature' | 'replay' | 'bad_payload',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

/** NFR-S4: signed requests only, and nothing older (or newer) than five minutes. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const mac = (secret: string, timestamp: number, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** Header value "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${mac(secret, timestamp, body)}`;
}

/** Verifies the signature and timestamp of a raw webhook body, then parses it. */
export function verifyWebhook(secret: string, header: string | undefined, rawBody: string, now = new Date()): EspEvent[] {
  if (!header) throw new WebhookError('missing_signature', 'Missing signature header');
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) throw new WebhookError('bad_signature', 'Malformed signature header');
  if (Math.abs(now.getTime() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new WebhookError('replay', 'Signature timestamp is outside the 5-minute window');
  const expected = Buffer.from(mac(secret, timestamp, rawBody));
  const given = Buffer.from(parts.v1);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new WebhookError('bad_signature', 'Signature does not match');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookError('bad_payload', 'Body is not JSON');
  }
  const parsed = webhookBodySchema.safeParse(json);
  if (!parsed.success) throw new WebhookError('bad_payload', parsed.error.issues[0]?.message ?? 'Invalid events');
  return parsed.data.events;
}
