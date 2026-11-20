import { describe, expect, it, vi } from 'vitest';
import { createEmailAdapter, type EmailMessage } from '../src/email/index.js';

const message: EmailMessage = {
  idempotencyKey: 'send-1:contact-1',
  stream: 'marketing',
  from: 'news@news.academy-domain.example',
  to: 'ani.student@example.test',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  headers: { 'List-Unsubscribe': '<https://hub.example/u/token>' },
};

describe('log email adapter', () => {
  it('logs the email instead of sending it', async () => {
    const logger = { info: vi.fn() };
    const adapter = createEmailAdapter('log', logger);
    const result = await adapter.send(message);
    expect(adapter.name).toBe('log');
    expect(result.messageId).toMatch(/^log-/);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('delivers an idempotency key at most once', async () => {
    const logger = { info: vi.fn() };
    const adapter = createEmailAdapter('log', logger);
    const first = await adapter.send(message);
    const second = await adapter.send(message);
    expect(second).toEqual(first);
    expect(logger.info).toHaveBeenCalledOnce();
  });
});
