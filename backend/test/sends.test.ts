import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliveries } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, currentTestDatabase, FakeDns, publishPlaceholderRecords } from './helpers.js';

const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let outbox: LogEmailAdapter;
let dns: FakeDns;
let linkStatus: Record<string, number | null>;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  dns = new FakeDns();
  linkStatus = {};
  app = await buildTestApp({ email: outbox, dnsResolver: dns, linkChecker: { status: async (url) => linkStatus[url] ?? 200 }, sleep: async () => {} });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });
});
afterEach(() => app.close());

const person = { kind: 'person' } as const;
async function subscriber(email: string, extra: Record<string, unknown> = {}) {
  const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email, language: 'hy', sourceChannel: 'events', ...extra } })).json();
  await app.consent.record(contact.id, { topics: ['courses'], state: 'granted', method: 'form' }, person);
  return contact;
}
async function segment() {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/audience/segments',
      headers: bearer('editor'),
      payload: { name: 'Armenian', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] } },
    })
  ).json();
}
const campaign = (segmentId: string, extra: Record<string, unknown> = {}) => ({
  name: 'Spring intake',
  topic: 'courses',
  purpose: 'recruitment',
  segmentId,
  language: 'hy',
  fromName: 'Picsart Academy',
  fromAddress: `news@${DOMAIN}`,
  subject: 'Բարև, {{first_name}}',
  preheader: 'New groups start in March',
  body: 'Hello **{{first_name}}** <script>alert(1)</script>\n\nRead more: [the course](https://academy.example/courses/python?ref=x)\n\n![Students at the open day](https://academy.example/img.png)',
  buttonLabel: 'Apply',
  buttonUrl: 'https://academy.example/apply',
  ...extra,
});
async function createSend(segmentId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/email/sends', headers: bearer('editor'), payload: campaign(segmentId, extra) });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
const approve = (id: string, role = 'marketing_manager') => app.inject({ method: 'POST', url: `/api/email/sends/${id}/approve`, headers: bearer(role), payload: {} });
const marketing = () => outbox.outbox.filter((message) => message.stream === 'marketing');
const rows = async (sendId: string) => (await currentTestDatabase()).db.select().from(deliveries).where(eq(deliveries.sendId, sendId));

describe('campaign flow (Flow B, EML-09, EML-10, EML-11, EML-16)', () => {
  it('checks, approves and sends once per contact, rendered with footer, headers and tagged links', async () => {
    const anna = await subscriber('anna@example.test', { firstName: 'Anna' });
    await subscriber('bob@example.test');
    await subscriber('applicant@example.test');
    const seg = await segment();
    const send = await createSend(seg.id);

    const checks = (await app.inject({ method: 'GET', url: `/api/email/sends/${send.id}/checks`, headers: bearer('editor') })).json().checks;
    expect(checks.filter((c: { status: string }) => c.status !== 'pass')).toEqual([]);
    expect((await approve(send.id, 'editor')).statusCode).toBe(403);
    expect((await approve(send.id)).json()).toMatchObject({ status: 'scheduled', approvedBy: 'staff-marketing_manager' });

    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(3);
    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(3);
    expect((await app.sends.get(send.id))).toMatchObject({ status: 'sent', sentCount: 3 });

    const toAnna = marketing().find((m) => m.to === 'anna@example.test')!;
    expect(toAnna.subject).toBe('Բարև, Anna');
    expect(toAnna.html).toContain('<strong>Anna</strong>');
    expect(toAnna.html).not.toContain('<script>');
    expect(toAnna.html).toContain('utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=spring_intake');
    expect(toAnna.html).toMatch(/mh=[\w-]+\.[\w-]+/);
    expect(toAnna.html).toContain('alt="Students at the open day"');
    expect(toAnna.html).toContain('Picsart Academy, address to be confirmed');
    expect(toAnna.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(toAnna.text).toContain('/p/unsubscribe?t=');
    expect(toAnna.idempotencyKey).toBe(`${send.id}:${anna.id}`);

    const log = (await app.inject({ method: 'GET', url: `/api/email/sends/${send.id}/log`, headers: bearer('editor') })).json();
    expect(log.total).toBe(3);
    expect(log.deliveries[0]).toMatchObject({ status: 'sent', espMessageId: expect.stringMatching(/^log-/), sentAt: expect.any(String) });
  });

  it('blocks approval while a check fails', async () => {
    await subscriber('anna@example.test');
    const seg = await segment();
    linkStatus['https://academy.example/apply'] = 404;
    const send = await createSend(seg.id, { body: 'No alt: ![](https://academy.example/x.png)' });
    const response = await approve(send.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/Links, Image alt text/);
  });

  it('drops contacts who unsubscribe after scheduling, and respects the monthly frequency', async () => {
    const leaving = await subscriber('leaving@example.test');
    const monthly = await subscriber('monthly@example.test');
    await subscriber('stays@example.test');
    const seg = await segment();
    const first = await createSend(seg.id, { name: 'First', subject: 'First' });
    await approve(first.id);
    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(3);

    await app.inject({ method: 'PUT', url: `/api/public/preferences?t=${app.signer.sign(monthly.id, 'preferences')}`, payload: { topics: ['courses'], language: 'hy', frequency: 'monthly' } });
    const second = await createSend(seg.id, { name: 'Second', subject: 'Second' });
    await approve(second.id);
    await app.dispatcher.start(second.id);
    await app.consent.unsubscribeAll(leaving.id, 'link', person);
    await app.dispatcher.tick();
    const secondRows = await rows(second.id);
    expect(secondRows.map((r) => [r.email, r.status, r.skipReason]).sort()).toEqual([
      ['leaving@example.test', 'skipped', 'suppressed'],
      ['monthly@example.test', 'skipped', 'frequency: monthly'],
      ['stays@example.test', 'sent', null],
    ]);
  });

  it('never resends after a crash and retries ESP errors with backoff', async () => {
    await subscriber('a@example.test');
    await subscriber('b@example.test');
    const seg = await segment();
    const send = await createSend(seg.id);
    await approve(send.id);
    await app.dispatcher.start(send.id);
    const db = (await currentTestDatabase()).db;
    const [crashed] = await rows(send.id);
    await db.update(deliveries).set({ status: 'sending', updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(deliveries.id, crashed!.id));

    const spy = vi.spyOn(outbox, 'send').mockRejectedValueOnce(new Error('ESP 503'));
    await app.dispatcher.tick();
    const after = await rows(send.id);
    expect(after.find((r) => r.id === crashed!.id)).toMatchObject({ status: 'unknown' });
    expect(after.find((r) => r.id !== crashed!.id)).toMatchObject({ status: 'queued', attempts: 1, lastError: 'ESP 503' });
    spy.mockRestore();
    await db.update(deliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(deliveries.sendId, send.id));
    await app.dispatcher.tick();
    expect((await rows(send.id)).map((r) => r.status).sort()).toEqual(['sent', 'unknown']);
  });
});

describe('kill switch, warm-up and test sends (EML-14, EML-08, EML-13)', () => {
  it('pauses all marketing sending with one switch', async () => {
    await subscriber('a@example.test');
    const seg = await segment();
    const send = await createSend(seg.id);
    await approve(send.id);
    expect((await app.inject({ method: 'PUT', url: '/api/email/kill-switch', headers: bearer('editor'), payload: { paused: true } })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: '/api/email/kill-switch', headers: bearer('marketing_manager'), payload: { paused: true, reason: 'Complaint spike' } });
    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(0);
    await expect(app.email.send({ idempotencyKey: 'k', stream: 'marketing', from: `x <news@${DOMAIN}>`, to: 'a@example.test', subject: 's', html: '', text: '' })).rejects.toThrow(/kill switch/);
    await app.inject({ method: 'PUT', url: '/api/email/kill-switch', headers: bearer('admin'), payload: { paused: false } });
    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(1);
  });

  it('stops at the warm-up cap and sends to the most engaged contacts first', async () => {
    const domain = (await app.domains.list())[0]!;
    await app.domains.remove(domain.id, { userId: 'staff-admin' });
    const fresh = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
    await app.domains.verify(fresh.id); // day 1: cap 50
    const contacts = [];
    for (let i = 0; i < 52; i += 1) contacts.push(await subscriber(`c${String(i).padStart(2, '0')}@example.test`));
    await app.touchpoints.record({ contactId: contacts[51].id, channel: 'email', campaign: null, type: 'click', occurredAt: new Date(), sourceSystem: 'esp', sourceRef: 'x' });
    const seg = await segment();
    const send = await createSend(seg.id);
    await approve(send.id);
    await app.dispatcher.tick();
    expect(marketing()).toHaveLength(50);
    expect(marketing()[0]!.to).toBe('c51@example.test');
    expect((await app.sends.get(send.id))?.status).toBe('sending');
    expect((await rows(send.id)).filter((r) => r.status === 'queued')).toHaveLength(2);
  });

  it('sends a marked test to the seed list and previews the email', async () => {
    await subscriber('a@example.test', { firstName: 'Ani' });
    const seg = await segment();
    const send = await createSend(seg.id);
    const test = await app.inject({ method: 'POST', url: `/api/email/sends/${send.id}/test`, headers: bearer('editor'), payload: { emails: ['seed1@academy.example', 'seed2@academy.example'] } });
    expect(test.json()).toEqual({ sent: 2 });
    expect(outbox.outbox.map((m) => m.subject)).toEqual(['[Test] Բարև, ընկեր', '[Test] Բարև, ընկեր']);
    const preview = (await app.inject({ method: 'GET', url: `/api/email/sends/${send.id}/preview`, headers: bearer('editor') })).json();
    expect(preview.subject).toBe('Բարև, Ani');
    expect(preview.html).toContain('color-scheme');
  });
});
