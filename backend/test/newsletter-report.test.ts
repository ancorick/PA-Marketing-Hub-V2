import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deliveries, outcomes } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { signWebhook } from '../src/email/webhooks.js';
import { bearer, buildTestApp, currentTestDatabase, FakeDns, publishPlaceholderRecords, testConfig } from './helpers.js';

const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let issueId: string;
const readers: Record<string, string> = {};

beforeEach(async () => {
  const dns = new FakeDns();
  app = await buildTestApp({
    email: new LogEmailAdapter({ info: () => {} }),
    dnsResolver: dns,
    sleep: async () => {},
    linkChecker: { status: async () => 200, contentLength: async () => 1000 },
    config: testConfig({ MAIL_FROM: `Picsart Academy <news@${DOMAIN}>`, ADMISSIONS_URL: 'https://academy.example/admissions' }),
  });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });
  for (const name of ['ani', 'aram', 'lilit']) {
    const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: `${name}@example.test`, language: 'en', sourceChannel: 'events' } })).json();
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form' }, { kind: 'person' });
    readers[name] = contact.id;
  }
  const segment = await app.segments.create({ name: 'English', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['en'] }] } }, 'x');
  await app.newsletter.saveCadence({ name: 'Monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['en'], segments: { en: segment.id }, active: true });
  await app.newsletter.schedule();
  issueId = (await app.newsletter.list())[0]!.id;
  await app.newsletter.collectAndDraft(issueId);
  await app.publishing.approve(issueId, 'staff-marketing_manager', null, new Date(Date.now() - 1000));
  await app.dispatcher.tick();
  await app.jobs.run('newsletter_schedule', 'test');
});
afterEach(() => app.close());

async function click(contact: string, blockId: string) {
  const db = (await currentTestDatabase()).db;
  const issue = await app.newsletter.require(issueId);
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.contactId, readers[contact]!));
  const messageId = delivery!.espMessageId!;
  expect(delivery!.sendId).toBe(issue.sendId);
  const body = JSON.stringify({ events: [{ id: `c-${contact}-${blockId}`, type: 'clicked', messageId, occurredAt: new Date(Date.now() - 60_000).toISOString(), url: `https://academy.example/x?utm_content=${blockId}` }] });
  await app.inject({ method: 'POST', url: '/api/webhooks/esp', headers: { 'content-type': 'application/json', 'x-mh-signature': signWebhook('development-only-esp-webhook-secret-0123456789', body) }, payload: body });
}

describe('issue report (NWS-13, story NWS-S3)', () => {
  it('counts deliveries and unique clicks per block, and applications and registrations by clickers', async () => {
    const blocks = await app.newsletter.blocks(issueId);
    const [lead, second] = [blocks[0]!, blocks[1]!];
    await click('ani', lead.id);
    await click('ani', lead.id);
    await click('aram', second.id);
    const db = (await currentTestDatabase()).db;
    await db.insert(outcomes).values({ contactId: readers.ani!, type: 'applied', occurredAt: new Date(), sourceSystem: 'navigator_crm', sourceRef: 'l-ani' });
    await db.insert(outcomes).values({ contactId: readers.lilit!, type: 'applied', occurredAt: new Date(), sourceSystem: 'navigator_crm', sourceRef: 'l-lilit' });
    await app.touchpoints.record({ contactId: readers.aram!, channel: 'events', campaign: 'open_day', type: 'registration', occurredAt: new Date(), sourceSystem: 'event_hub', sourceRef: 'r1' });

    const report = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/report`, headers: bearer('editor') })).json();
    expect(report).toMatchObject({ delivered: 3, uniqueClicks: 2, applications: 1, registrations: 1, final: false, complaints: 0 });
    expect(report.blocks.find((block: { id: string }) => block.id === lead.id)).toMatchObject({ uniqueClicks: 1, applications: 1, registrations: 0 });
    expect(report.blocks.find((block: { id: string }) => block.id === second.id)).toMatchObject({ uniqueClicks: 1, applications: 0, registrations: 1 });
  });
});

describe('public archive (NWS-12)', () => {
  it('publishes the sent issue at a stable URL without personal links', async () => {
    const issue = await app.newsletter.require(issueId);
    expect(issue).toMatchObject({ status: 'sent', archiveSlug: `${issue.edition}-en` });
    const list = (await app.inject({ method: 'GET', url: '/api/public/newsletter?language=en' })).json();
    expect(list.issues).toEqual([expect.objectContaining({ slug: `${issue.edition}-en`, subject: issue.subject })]);
    const page = await app.inject({ method: 'GET', url: `/api/public/newsletter/${issue.edition}-en` });
    expect(page.json().html).toContain('web version');
    expect(page.json().html).not.toContain('/p/unsubscribe');
    expect(page.json().html).not.toMatch(/[?&]mh=/);
    expect(page.json().html).toContain('utm_medium=archive');
    expect((await app.inject({ method: 'GET', url: '/api/public/newsletter/nope' })).statusCode).toBe(404);
  });
});
