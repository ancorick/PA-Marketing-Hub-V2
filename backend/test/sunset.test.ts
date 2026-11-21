import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contacts, deliveries, sends } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { signWebhook } from '../src/email/webhooks.js';
import { bearer, buildTestApp, currentTestDatabase, FakeDns, publishPlaceholderRecords, testConfig } from './helpers.js';

const DOMAIN = 'news.academy.example';
const DAY = 86_400_000;
let app: FastifyInstance;
let outbox: LogEmailAdapter;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  const dns = new FakeDns();
  app = await buildTestApp({ config: testConfig({ MAIL_FROM: `Picsart Academy <news@${DOMAIN}>` }), email: outbox, dnsResolver: dns, sleep: async () => {} });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });
});
afterEach(() => app.close());

/** A subscriber who received a campaign 400 days ago; `engaged` adds a click 30 days ago. */
async function subscriber(email: string, engaged = false) {
  const db = (await currentTestDatabase()).db;
  const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email, firstName: 'Ani', language: 'hy', sourceChannel: 'events' } })).json();
  await app.consent.record(contact.id, { topics: ['events'], state: 'granted', method: 'form' }, { kind: 'person' });
  let [old] = await db.select().from(sends).where(eq(sends.name, 'Old campaign'));
  if (!old) {
    [old] = await db
      .insert(sends)
      .values({ name: 'Old campaign', topic: 'events', language: 'hy', fromName: 'A', fromAddress: `news@${DOMAIN}`, subject: 's', body: 'b', utmCampaign: 'old', status: 'sent', createdBy: 'x' })
      .returning();
  }
  await db.insert(deliveries).values({ sendId: old!.id, contactId: contact.id, email, status: 'delivered', sentAt: new Date(Date.now() - 400 * DAY) });
  if (engaged) await app.touchpoints.record({ contactId: contact.id, channel: 'email', campaign: 'old', type: 'click', occurredAt: new Date(Date.now() - 30 * DAY), sourceSystem: 'esp', sourceRef: email });
  return contact;
}

describe('sunset policy (EML-15)', () => {
  it('sends a re-engagement email after 12 quiet months, then moves silent contacts out of regular sends', async () => {
    const quiet = await subscriber('quiet@example.test');
    await subscriber('active@example.test', true);

    await app.jobs.run('sunset_policy', 'test');
    await app.dispatcher.tick();
    const mail = outbox.outbox.filter((m) => m.stream === 'marketing');
    expect(mail.map((m) => m.to)).toEqual(['quiet@example.test']);
    expect(mail[0]!.subject).toMatch(/Picsart Academy/);
    expect(mail[0]!.html).toContain('stay=1');
    const sent = (await app.sends.list()).find((s) => s.kind === 'reengagement');
    expect(sent).toMatchObject({ status: 'sent', sentCount: 1, approvedBy: 'sunset_policy' });

    // Running again does not send a second one.
    await app.jobs.run('sunset_policy', 'test');
    await app.dispatcher.tick();
    expect(outbox.outbox.filter((m) => m.stream === 'marketing')).toHaveLength(1);

    // 31 days of silence: out of regular sends.
    const db = (await currentTestDatabase()).db;
    await db.update(contacts).set({ reengagementSentAt: new Date(Date.now() - 31 * DAY) }).where(eq(contacts.id, quiet.id));
    await app.jobs.run('sunset_policy', 'test');
    expect((await app.contacts.get(quiet.id))?.sunsetAt).toBeTruthy();
    const segment = await app.segments.create({ name: 'All hy', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] } }, 'x');
    expect((await app.segments.audience(segment.id, { topic: 'events' })).map((c) => c.email)).toEqual(['active@example.test']);
  });

  it('brings a contact back on "keep me subscribed" or a click', async () => {
    const quiet = await subscriber('quiet@example.test');
    const db = (await currentTestDatabase()).db;
    await db.update(contacts).set({ reengagementSentAt: new Date(Date.now() - 40 * DAY), sunsetAt: new Date() }).where(eq(contacts.id, quiet.id));
    const stay = await app.inject({ method: 'POST', url: `/api/public/preferences/stay?t=${app.signer.sign(quiet.id, 'preferences')}` });
    expect(stay.statusCode).toBe(200);
    expect(await app.contacts.get(quiet.id)).toMatchObject({ sunsetAt: null, reengagementSentAt: null });

    await db.update(contacts).set({ sunsetAt: new Date() }).where(eq(contacts.id, quiet.id));
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.contactId, quiet.id));
    await db.update(deliveries).set({ espMessageId: 'esp-1' }).where(eq(deliveries.id, delivery!.id));
    const body = JSON.stringify({ events: [{ id: 'e1', type: 'clicked', messageId: 'esp-1', occurredAt: new Date().toISOString() }] });
    await app.inject({ method: 'POST', url: '/api/webhooks/esp', headers: { 'content-type': 'application/json', 'x-mh-signature': signWebhook('development-only-esp-webhook-secret-0123456789', body) }, payload: body });
    expect((await app.contacts.get(quiet.id))?.sunsetAt).toBeNull();
  });
});
