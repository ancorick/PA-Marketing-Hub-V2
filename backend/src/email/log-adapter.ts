import { randomUUID } from 'node:crypto';
import type { EmailAdapter, EmailMessage, EmailSendResult } from './adapter.js';

type Logger = { info: (obj: object, msg: string) => void };

/**
 * Development adapter: writes each email to the log instead of sending it.
 * Repeated idempotency keys return the first result, mirroring the at-most-once contract.
 */
export class LogEmailAdapter implements EmailAdapter {
  readonly name = 'log';
  private readonly sent = new Map<string, EmailSendResult>();

  constructor(private readonly logger: Logger) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const existing = this.sent.get(message.idempotencyKey);
    if (existing) return existing;

    const result: EmailSendResult = { messageId: `log-${randomUUID()}`, acceptedAt: new Date() };
    this.sent.set(message.idempotencyKey, result);
    this.logger.info(
      {
        email: {
          messageId: result.messageId,
          idempotencyKey: message.idempotencyKey,
          stream: message.stream,
          from: message.from,
          to: message.to,
          subject: message.subject,
          headers: message.headers ?? {},
          textPreview: message.text.slice(0, 500),
        },
      },
      'email (log adapter, not sent)',
    );
    return result;
  }
}
