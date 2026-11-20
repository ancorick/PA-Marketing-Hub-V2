import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConsentView } from '../src/consent/service.js';
import type { ContactView } from '../src/contacts/service.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import { createIntegrations } from '../src/integrations/index.js';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
let coreEngine: MockCoreEngineClient;
const person = { kind: 'person' } as const;
const staff = { kind: 'staff', userId: 'staff-marketing_manager' } as const;

beforeEach(async () => {
  const integrations = createIntegrations('mock');
  coreEngine = integrations.coreEngine as MockCoreEngineClient;
  app = await buildTestApp({ integrations });
});
afterEach(() => app.close());

const newContact = async (email = 'anna@example.test') =>
  (
    await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email, language: 'hy', sourceChannel: 'events' } })
  ).json<ContactView>();

const view = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/audience/contacts/${id}/consent`, headers: bearer('editor') })).json<ConsentView>();

const stateOf = async (id: string, topic: string) => (await view(id)).topics.find((t) => t.topic === topic)?.state;

describe('consent records (AUD-07, PRD 6.3)', () => {
  it('starts as unknown and records form consent with wording version, URL and IP', async () => {
    const contact = await newContact();
    expect((await view(contact.id)).topics.every((t) => t.state === 'unknown')).toBe(true);
    await app.consent.record(
      contact.id,
      { topics: ['newsletter'], state: 'granted', method: 'form', wordingVersion: 'newsletter-hy-v1', sourceUrl: 'https://academy.example/courses', ip: '203.0.113.7' },
      person,
    );
    const consent = await view(contact.id);
    expect(consent.topics.find((t) => t.topic === 'newsletter')).toMatchObject({ state: 'granted', method: 'form', wordingVersion: 'newsletter-hy-v1' });
    expect(consent.history[0]).toMatchObject({ sourceUrl: 'https://academy.example/courses', state: 'granted' });
  });

  it('rejects an unknown wording or one written for another topic', async () => {
    const contact = await newContact();
    await expect(app.consent.record(contact.id, { topics: ['events'], state: 'granted', method: 'form', wordingVersion: 'newsletter-hy-v1' }, person)).rejects.toThrow(/newsletter topic/);
    await expect(app.consent.record(contact.id, { topics: ['events'], state: 'granted', method: 'form', wordingVersion: 'nope' }, person)).rejects.toThrow(/Unknown/);
  });

  it('lets managers change consent manually only with a reason, logged to the Core Engine', async () => {
    const contact = await newContact();
    const url = `/api/audience/contacts/${contact.id}/consent`;
    expect((await app.inject({ method: 'POST', url, headers: bearer('editor'), payload: { topics: ['events'], state: 'granted', reason: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers: bearer('marketing_manager'), payload: { topics: ['events'], state: 'granted' } })).statusCode).toBe(400);
    const changed = await app.inject({
      method: 'POST',
      url,
      headers: bearer('marketing_manager'),
      payload: { topics: ['events'], state: 'granted', reason: 'Asked at the open day desk' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<ConsentView>().history[0]).toMatchObject({ method: 'manual', actorId: 'staff-marketing_manager', reason: 'Asked at the open day desk' });
    expect(coreEngine.activityLog.at(-1)).toMatchObject({ action: 'consent.changed', subjectId: contact.id, reason: 'Asked at the open day desk' });
  });

  it('never lets an import turn a withdrawal back into consent (most restrictive wins)', async () => {
    const contact = await newContact();
    await app.consent.record(contact.id, { topics: ['courses'], state: 'withdrawn', method: 'link' }, person);
    const written = await app.consent.record(contact.id, { topics: ['courses', 'events'], state: 'granted', method: 'import' }, { kind: 'system', name: 'import' });
    expect(written.map((r) => r.topic)).toEqual(['events']);
    expect(await stateOf(contact.id, 'courses')).toBe('withdrawn');
  });
});

describe('unsubscribe and the suppression list (AUD-09, AUD-12)', () => {
  it('suppresses at once, withdraws every topic and marks the contact unsubscribed; undo restores it', async () => {
    const contact = await newContact();
    await app.consent.record(contact.id, { topics: ['newsletter', 'events'], state: 'granted', method: 'form' }, person);
    await app.consent.unsubscribeAll(contact.id, 'link', person);
    await app.consent.unsubscribeAll(contact.id, 'link', person); // idempotent

    const after = await view(contact.id);
    expect(after.topics.every((t) => t.state === 'withdrawn')).toBe(true);
    expect(after.suppressed).toEqual([expect.objectContaining({ reason: 'unsubscribed', source: 'link' })]);
    expect(await app.consent.isSuppressed('ANNA@example.test')).toBe(true);
    expect((await app.contacts.get(contact.id))?.status).toBe('unsubscribed');

    await app.consent.undoUnsubscribe(contact.id);
    const undone = await view(contact.id);
    expect(undone.suppressed).toEqual([]);
    expect(undone.topics.filter((t) => t.state === 'granted').map((t) => t.topic).sort()).toEqual(['events', 'newsletter']);
    expect((await app.contacts.get(contact.id))?.status).toBe('active');
  });

  it('blocks staff and imports from overriding a suppression; only the person can opt in again', async () => {
    const contact = await newContact();
    await app.consent.unsubscribeAll(contact.id, 'link', person);
    const manual = await app.inject({
      method: 'POST',
      url: `/api/audience/contacts/${contact.id}/consent`,
      headers: bearer('admin'),
      payload: { topics: ['newsletter'], state: 'granted', reason: 'They asked by phone' },
    });
    expect(manual.statusCode).toBe(400);
    expect(manual.json().message).toMatch(/suppression list/);
    expect(await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'import' }, { kind: 'system', name: 'import' })).toEqual([]);

    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'link' }, person);
    expect(await app.consent.isSuppressed(contact.email!)).toBe(false);
  });

  it('keeps bounces and complaints: a complaint unsubscribes from everything; a new record starts suppressed', async () => {
    const contact = await newContact();
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form' }, person);
    await app.consent.suppress(contact.email!, 'complaint', 'esp_webhook');
    expect((await app.contacts.get(contact.id))?.status).toBe('complained');
    expect(await stateOf(contact.id, 'newsletter')).toBe('withdrawn');
    // The person's own opt-in does not lift a complaint.
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'link' }, person);
    expect((await app.contacts.get(contact.id))?.status).toBe('complained');

    await app.consent.suppress('bounced@example.test', 'hard_bounce', 'esp_webhook');
    expect((await newContact('Bounced@example.test')).status).toBe('bounced');
    const summary = await app.inject({ method: 'GET', url: '/api/audience/suppressions/summary', headers: bearer('editor') });
    expect(summary.json().active).toMatchObject({ complaint: 1, hard_bounce: 1, unsubscribed: 0 });
  });

  it('lets managers unsubscribe a contact by hand with a reason', async () => {
    const contact = await newContact();
    const response = await app.inject({
      method: 'POST',
      url: `/api/audience/contacts/${contact.id}/unsubscribe`,
      headers: bearer('marketing_manager'),
      payload: { reason: 'Replied STOP to the newsletter' },
    });
    expect(response.json<ConsentView>().suppressed[0]).toMatchObject({ reason: 'unsubscribed', source: 'manual' });
    expect(coreEngine.activityLog.at(-1)).toMatchObject({ action: 'consent.unsubscribed_all', reason: 'Replied STOP to the newsletter' });
  });
});
