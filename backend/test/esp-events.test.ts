import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contactImports, deliveries } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { signWebhook, verifyWebhook } from '../src/email/webhooks.js';
import { bearer, buildTestApp, currentTestDatabase, FakeDns, publishPlaceholderRecords } from './helpers.js';

const SECRET = 'development-only-esp-webhook-secret-0123456789';
const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let outbox: LogEmailAdapter;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  const dns = new FakeDns();
  app = await buildTestApp({ email: outbox, dnsResolver: dns, linkChecker: { status: async () => 200 }, sleep: async () => {} });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });
});
afterEach(() => app.close());

let counter = 0;
const event = (type: string, messageId: string, extra: Record<string, unknown> = {}) => ({ id: `evt-${(counter += 1)}`, type, messageId, occurredAt: new Date().toISOString(), ...extra });
const post = (events: unknown[], options: { secret?: string; timestamp?: number; body?: string } = {}) => {
  const body = options.body ?? JSON.stringify({ events });
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/esp',
    headers: { 'content-type': 'application/json', 'x-mh-signature': signWebhook(options.secret ?? SECRET, body, options.timestamp) },
    payload: body,
  });
};

/** Sends a campaign to `count` subscribers; returns the ESP message ID per email. */
async function sendTo(count: number, options: { importCsv?: boolean } = {}) {
  if (options.importCsv) {
    const lines = ['email,consent', ...Array.from({ length: count }, (_, i) => `p${i}@example.test,yes`)];
    await app.inject({
      method: 'POST',
      url: '/api/audience/imports',
      headers: bearer('editor'),
      payload: { fileName: 'old-list.csv', csv: lines.join('\n'), options: { defaultLanguage: 'hy', defaultSourceChannel: 'events', consentTopic: 'courses' } },
    });
  } else {
    for (let i = 0; i < count; i += 1) {
      const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: `p${i}@example.test`, language: 'hy', sourceChannel: 'events' } })).json();
      await app.consent.record(contact.id, { topics: ['courses'], state: 'granted', method: 'form' }, { kind: 'person' });
    }
  }
  const segment = (
    await app.inject({ method: 'POST', url: '/api/audience/segments', headers: bearer('editor'), payload: { name: 'All', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] } } })
  ).json();
  const send = (
    await app.inject({
      method: 'POST',
      url: '/api/email/sends',
      headers: bearer('editor'),
      payload: { name: 'Intake', topic: 'courses', segmentId: segment.id, language: 'hy', fromName: 'Academy', fromAddress: `news@${DOMAIN}`, subject: 'Hi', body: 'Hello [site](https://academy.example)' },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/email/sends/${send.id}/approve`, headers: bearer('marketing_manager'), payload: {} });
  await app.dispatcher.start(send.id);
  const rows = await (await currentTestDatabase()).db.select().from(deliveries).where(eq(deliveries.sendId, send.id));
  // Start only queues: deliver a first batch of up to `count`.
  await app.dispatcher.tick();
  const sent = await (await currentTestDatabase()).db.select().from(deliveries).where(eq(deliveries.sendId, send.id));
  void rows;
  return { sendId: send.id as string, ids: new Map(sent.map((row) => [row.email!, row.espMessageId!])) };
}

describe('webhook security (EML-04, NFR-S4)', () => {
  it('accepts signed events and rejects forged, replayed and malformed ones', async () => {
    expect((await post([event('delivered', 'm1')])).json()).toEqual({ processed: 1, duplicates: 0 });
    expect((await post([event('delivered', 'm1')], { secret: 'x'.repeat(40) })).statusCode).toBe(401);
    expect((await post([event('delivered', 'm1')], { timestamp: Math.floor(Date.now() / 1000) - 301 })).json().error).toBe('replay');
    expect((await post([], { body: '{"events": [{"id": 1}]}' })).statusCode).toBe(400);
    const unsigned = await app.inject({ method: 'POST', url: '/api/webhooks/esp', headers: { 'content-type': 'application/json' }, payload: '{"events":[]}' });
    expect(unsigned.statusCode).toBe(401);
    expect(() => verifyWebhook(SECRET, signWebhook(SECRET, '{}'), '{"tampered":1}')).toThrow(/does not match/);
  });

  it('processes each event ID once, as providers retry', async () => {
    const same = event('delivered', 'm1');
    await post([same]);
    expect((await post([same])).json()).toEqual({ processed: 0, duplicates: 1 });
  });
});

describe('bounces, complaints and engagement (EML-04, EML-05, EML-06)', () => {
  it('updates the send log, records opens and clicks as touchpoints, and handles bounces and complaints', async () => {
    const { sendId, ids } = await sendTo(4);
    await post([
      event('delivered', ids.get('p0@example.test')!),
      event('opened', ids.get('p0@example.test')!),
      event('clicked', ids.get('p0@example.test')!, { url: 'https://academy.example' }),
      event('bounced', ids.get('p1@example.test')!, { bounceType: 'hard' }),
      event('complained', ids.get('p2@example.test')!),
    ]);
    const rows = await (await currentTestDatabase()).db.select().from(deliveries).where(eq(deliveries.sendId, sendId));
    const by = (email: string) => rows.find((row) => row.email === email)!;
    expect(by('p0@example.test')).toMatchObject({ status: 'delivered', openedAt: expect.any(Date), firstClickAt: expect.any(Date) });
    expect(by('p1@example.test').status).toBe('bounced_hard');
    expect(await app.consent.isSuppressed('p1@example.test')).toBe(true);
    const complainer = (await app.contacts.list({ search: 'p2@', limit: 1, offset: 0 })).contacts[0]!;
    expect(complainer.status).toBe('complained');
    expect((await app.consent.current(complainer.id)).courses).toBe('withdrawn');
    const clicker = (await app.contacts.list({ search: 'p0@', limit: 1, offset: 0 })).contacts[0]!;
    expect((await app.touchpoints.forContact(clicker.id)).map((t) => [t.type, t.channel, t.campaign]).sort()).toEqual([
      ['click', 'email', 'intake'],
      ['open', 'email', 'intake'],
    ]);
    const report = (await app.inject({ method: 'GET', url: `/api/email/sends/${sendId}/report`, headers: bearer('editor') })).json();
    expect(report).toMatchObject({ clicked: 1, openedEstimated: 1 });
  });

  it('suppresses after three soft bounces in 30 days and flags the address for review', async () => {
    const { ids } = await sendTo(1);
    const db = (await currentTestDatabase()).db;
    // Two earlier soft bounces to the same address in other sends.
    const [row] = await db.select().from(deliveries);
    for (let i = 0; i < 2; i += 1) {
      await db.insert(deliveries).values({ sendId: row!.sendId, contactId: null, email: 'p0@example.test', status: 'bounced_soft', sentAt: new Date() });
    }
    await post([event('bounced', ids.get('p0@example.test')!, { bounceType: 'soft' })]);
    expect(await app.consent.isSuppressed('p0@example.test')).toBe(true);
    const alerts = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer('marketing_manager') })).json().alerts;
    expect(alerts[0]).toMatchObject({ title: expect.stringMatching(/soft bounces/), level: 'warning' });
  });

  it('unsubscribes on an ESP unsubscribe event and counts link unsubscribes per campaign', async () => {
    const { sendId, ids } = await sendTo(2);
    await post([event('unsubscribed', ids.get('p0@example.test')!)]);
    expect((await app.contacts.list({ search: 'p0@', limit: 1, offset: 0 })).contacts[0]!.status).toBe('unsubscribed');
    const message = outbox.outbox.find((m) => m.to === 'p1@example.test')!;
    const token = message.text.match(/\/p\/unsubscribe\?t=([\w.-]+)/)![1];
    await app.inject({ method: 'POST', url: `/api/public/unsubscribe?t=${token}` });
    const report = (await app.inject({ method: 'GET', url: `/api/email/sends/${sendId}/report`, headers: bearer('editor') })).json();
    expect(report.unsubscribed).toBe(2);
  });
});

describe('deliverability guardrails (PRD 7.4)', () => {
  it('pauses a send above 5% hard bounces and alerts the marketing manager', async () => {
    const { sendId, ids } = await sendTo(20);
    // Bounces arrive while the send is still going out.
    await app.sends.setStatus(sendId, { status: 'sending' });
    await post([event('bounced', ids.get('p0@example.test')!, { bounceType: 'hard' }), event('bounced', ids.get('p1@example.test')!, { bounceType: 'hard' })]);
    expect(await app.sends.get(sendId)).toMatchObject({ status: 'paused', pausedReason: expect.stringMatching(/hard bounces 10\.0%/) });
    const alerts = (await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer('marketing_manager') })).json().alerts;
    expect(alerts.map((a: { title: string }) => a.title)).toEqual([expect.stringMatching(/paused by a deliverability guardrail/)]);
    expect((await app.inject({ method: 'GET', url: '/api/alerts', headers: bearer('viewer') })).json().alerts).toEqual([]);
  });

  it('blocks an import whose first send bounces above 10% until a manager reviews it', async () => {
    const { ids } = await sendTo(20, { importCsv: true });
    await post([0, 1, 2].map((i) => event('bounced', ids.get(`p${i}@example.test`)!, { bounceType: 'hard' })));
    const [record] = await (await currentTestDatabase()).db.select().from(contactImports);
    expect(record?.sendBlockedAt).toBeTruthy();
    const segment = (await app.segments.list())[0]!;
    expect(await app.segments.audience(segment.id, { topic: 'courses' })).toHaveLength(0);
    await app.inject({ method: 'POST', url: `/api/audience/imports/${record!.id}/review`, headers: bearer('marketing_manager') });
    expect((await app.segments.audience(segment.id, { topic: 'courses' })).length).toBe(17);
  });

  it('pauses all sending on an ESP account warning', async () => {
    await post([{ id: 'acct-1', type: 'account_warning', occurredAt: new Date().toISOString(), detail: 'Bounce rate under review' }]);
    expect(await app.killSwitch.state()).toMatchObject({ paused: true, reason: expect.stringMatching(/Bounce rate under review/) });
  });
});
