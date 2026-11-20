/**
 * One interface for every email service provider (PRD 7.1, 11.3 rule 1).
 * The real ESP is chosen in Milestone 0 (PRD 16.3, question 1); until then the log adapter is used.
 */
export type EmailStream = 'marketing' | 'transactional';

export type EmailMessage = {
  /** send ID + contact ID; the ESP layer must deliver a key at most once (EML-10). */
  idempotencyKey: string;
  stream: EmailStream;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe and List-Unsubscribe-Post (AUD-10). */
  headers?: Record<string, string>;
  tags?: Record<string, string>;
};

export type EmailSendResult = {
  /** Provider message ID, stored in the send log (EML-16). */
  messageId: string;
  acceptedAt: Date;
};

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
