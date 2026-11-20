import { randomUUID } from 'node:crypto';
import type { EmailAdapter, EmailMessage, EmailSendResult, EspDomainIdentity } from './adapter.js';

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

  /**
   * No ESP is chosen yet (PRD 16.3, question 1), so the identity is a placeholder under the
   * reserved `.invalid` TLD (RFC 2606): it can never resolve, so publishing it by mistake does nothing.
   */
  async registerDomain(): Promise<EspDomainIdentity> {
    return {
      provider: 'log',
      placeholder: true,
      spfInclude: 'spf.esp-not-chosen.invalid',
      dkim: [{ selector: 'mh1', type: 'CNAME', value: 'mh1.dkim.esp-not-chosen.invalid' }],
      trackingLabel: 'click',
      trackingTarget: 'track.esp-not-chosen.invalid',
    };
  }

  async deregisterDomain(): Promise<void> {
    // Nothing is registered anywhere in log mode.
  }
}
