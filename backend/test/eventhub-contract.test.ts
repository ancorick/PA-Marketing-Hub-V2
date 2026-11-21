import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractFiles } from '../scripts/event-hub-contract.js';
import { findWording } from '../src/consent/wordings.js';
import { MESSAGE_TYPES, messageSchema } from '../src/eventhub/contract.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';

describe('Event Hub contract v1 (EVT-01)', () => {
  it('has one valid example per message type', () => {
    expect(EXAMPLE_MESSAGES.map((message) => message.type).sort()).toEqual([...MESSAGE_TYPES].sort());
    for (const message of EXAMPLE_MESSAGES) expect(messageSchema.safeParse(message).success).toBe(true);
    expect(new Set(EXAMPLE_MESSAGES.map((message) => message.id)).size).toBe(EXAMPLE_MESSAGES.length);
  });

  it('examples use published consent wordings', () => {
    for (const message of EXAMPLE_MESSAGES) {
      if (message.type !== 'registration.created') continue;
      for (const { topic, wordingVersion } of message.data.consent) expect(findWording(wordingVersion)?.topic).toBe(topic);
    }
  });

  it('rejects what the contract does not allow', () => {
    const registration = EXAMPLE_MESSAGES.find((message) => message.type === 'registration.created')!;
    expect(messageSchema.safeParse({ ...registration, version: '2' }).success).toBe(false);
    expect(messageSchema.safeParse({ ...registration, type: 'registration.updated' }).success).toBe(false);
    expect(messageSchema.safeParse({ ...registration, data: { ...registration.data, contact: { email: 'not-an-email' } } }).success).toBe(false);
    const event = EXAMPLE_MESSAGES[0]!;
    expect(messageSchema.safeParse({ ...event, data: { ...event.data, registrationUrl: 'http://insecure.example' } }).success).toBe(false);
  });

  it('the published files match the code (run npm run contract:event-hub after a change)', () => {
    const root = join(import.meta.dirname, '..', 'docs', 'event-hub');
    for (const [name, content] of Object.entries(contractFiles())) {
      expect(readFileSync(join(root, name), 'utf8').replace(/\r\n/g, '\n'), name).toBe(content);
    }
  });
});
