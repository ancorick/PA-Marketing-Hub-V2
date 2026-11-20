import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import type { ContactView } from '../src/contacts/service.js';
import { LinkSigner } from '../src/links/tokens.js';
import { bearer, buildTestApp, FRONTEND_ORIGIN } from './helpers.js';

let app: FastifyInstance;
let contact: ContactView;
const person = { kind: 'person' } as const;

beforeEach(async () => {
  app = await buildTestApp();
  contact = (
    await app.inject({
      method: 'POST',
      url: '/api/audience/contacts',
      headers: bearer('editor'),
      payload: { email: 'anna.petrosyan@example.test', language: 'ru', sourceChannel: 'events' },
    })
  ).json<ContactView>();
  await app.consent.record(contact.id, { topics: ['newsletter', 'events'], state: 'granted', method: 'form' }, person);
});
afterEach(() => app.close());

const token = (purpose: 'unsubscribe' | 'preferences') => app.signer.sign(contact.id, purpose);

describe('signed links (NFR-S5)', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const signer = new LinkSigner('x'.repeat(40), () => now);

  it('carries no personal data and rejects forged, wrong-purpose and expired tokens', () => {
    const value = signer.sign('6f1c2d1e-0000-4000-8000-000000000001', 'unsubscribe');
    expect(Buffer.from(value.split('.')[0]!, 'base64url').toString()).not.toMatch(/@/);
    expect(signer.verify(value, 'unsubscribe').contactId).toBe('6f1c2d1e-0000-4000-8000-000000000001');
    expect(() => signer.verify(value, 'preferences')).toThrow(/not valid/);
    expect(() => new LinkSigner('y'.repeat(40), () => now).verify(value, 'unsubscribe')).toThrow(/not valid/);
    expect(() => signer.verify(`${value}x`, 'unsubscribe')).toThrow(/not valid/);
    const later = new LinkSigner('x'.repeat(40), () => new Date(now.getTime() + 366 * 86_400_000));
    expect(() => later.verify(value, 'unsubscribe')).toThrow(/expired/);
  });

  it('requires a real secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: FRONTEND_ORIGIN })).toThrow(/LINK_SIGNING_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: FRONTEND_ORIGIN, LINK_SIGNING_SECRET: 'short' })).toThrow(/32/);
  });

  it('builds List-Unsubscribe headers for mail clients (AUD-10)', () => {
    const headers = app.links.unsubscribeHeaders(contact.id);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toMatch(/^<http:\/\/localhost:4000\/api\/public\/unsubscribe\?t=[\w-]+\.[\w-]+>$/);
    expect(app.links.unsubscribePage(contact.id)).toMatch(/^http:\/\/localhost:5173\/#\/p\/unsubscribe\?t=/);
  });
});

describe('one-click unsubscribe (AUD-09, AUD-10)', () => {
  it('accepts the RFC 8058 POST from a mail client and suppresses at once', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/unsubscribe?t=${token('unsubscribe')}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ unsubscribed: true, language: 'ru' });
    expect(JSON.stringify(response.json())).not.toContain('anna');
    const consent = await app.consent.view(contact.id);
    expect(consent?.suppressed[0]).toMatchObject({ reason: 'unsubscribed', source: 'list_unsubscribe' });
  });

  it('unsubscribes from the confirmation page, offers preferences and can be undone', async () => {
    const response = await app.inject({ method: 'POST', url: `/api/public/unsubscribe?t=${token('unsubscribe')}` });
    const { preferencesToken } = response.json();
    expect((await app.contacts.get(contact.id))?.status).toBe('unsubscribed');
    expect((await app.inject({ method: 'GET', url: `/api/public/preferences?t=${preferencesToken}` })).json()).toMatchObject({ suppressed: true, topics: [] });

    expect((await app.inject({ method: 'POST', url: `/api/public/unsubscribe/undo?t=${token('unsubscribe')}` })).statusCode).toBe(200);
    expect((await app.contacts.get(contact.id))?.status).toBe('active');
    expect((await app.consent.current(contact.id)).newsletter).toBe('granted');
  });

  it('rejects missing, forged and preferences tokens', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/public/unsubscribe' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/public/unsubscribe?t=abc.defghijklmn' })).json().error).toBe('invalid_link');
    expect((await app.inject({ method: 'POST', url: `/api/public/unsubscribe?t=${token('preferences')}` })).statusCode).toBe(400);
  });

  it('rate-limits public endpoints (NFR-S6)', async () => {
    const codes = [];
    for (let i = 0; i < 32; i += 1) codes.push((await app.inject({ method: 'GET', url: '/api/public/preferences?t=bad.token-value' })).statusCode);
    expect(codes.slice(0, 30).every((code) => code === 400)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('preferences page (AUD-11)', () => {
  it('shows a masked address with the current topics, language and frequency', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/public/preferences?t=${token('preferences')}` });
    expect(response.json()).toEqual({ email: 'a•••@example.test', language: 'ru', frequency: 'all', topics: ['newsletter', 'events'], suppressed: false });
  });

  it('changes topics, language and frequency as the person', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/public/preferences?t=${token('preferences')}`,
      payload: { topics: ['newsletter', 'courses'], language: 'hy', frequency: 'monthly' },
    });
    expect(response.json()).toMatchObject({ topics: ['newsletter', 'courses'], language: 'hy', frequency: 'monthly' });
    const consent = await app.consent.view(contact.id);
    expect(consent?.topics.find((t) => t.topic === 'events')?.state).toBe('withdrawn');
    expect(consent?.history[0]).toMatchObject({ method: 'link', actorId: null });
    expect((await app.contacts.get(contact.id))?.history.at(-1)).toMatchObject({ actorId: 'person', fields: expect.arrayContaining(['language', 'frequency']) });
  });

  it('unsubscribes from everything from the preferences page', async () => {
    const response = await app.inject({ method: 'POST', url: `/api/public/preferences/unsubscribe?t=${token('preferences')}` });
    expect(response.json()).toMatchObject({ suppressed: true, topics: [] });
    expect((await app.consent.view(contact.id))?.suppressed[0]?.source).toBe('preferences');
  });

  it('lets a person who unsubscribed opt in again from their own preferences link', async () => {
    await app.consent.unsubscribeAll(contact.id, 'link', person);
    await app.inject({
      method: 'PUT',
      url: `/api/public/preferences?t=${token('preferences')}`,
      payload: { topics: ['newsletter'], language: 'ru', frequency: 'all' },
    });
    expect((await app.contacts.get(contact.id))?.status).toBe('active');
  });
});
