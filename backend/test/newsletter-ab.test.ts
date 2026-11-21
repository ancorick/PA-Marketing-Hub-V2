import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deliveries, sends } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, currentTestDatabase, FakeDns, publishPlaceholderRecords, testConfig } from './helpers.js';

const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let outbox: LogEmailAdapter;
let issueId: string;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  const dns = new FakeDns();
  app = await buildTestApp({
    email: outbox,
    dnsResolver: dns,
    sleep: async () => {},
    linkChecker: { status: async () => 200, contentLength: async () => 1000 },
    config: testConfig({ MAIL_FROM: `Picsart Academy <news@${DOMAIN}>` }),
  });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });
  for (let i = 0; i < 20; i += 1) {
    const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: `r${i}@example.test`, language: 'en', sourceChannel: 'events' } })).json();
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form' }, { kind: 'person' });
  }
  const segment = await app.segments.create({ name: 'English', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['en'] }] } }, 'x');
  await app.newsletter.saveCadence({ name: 'Monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['en'], segments: { en: segment.id }, active: true });
  await app.newsletter.schedule();
  issueId = (await app.newsletter.list())[0]!.id;
  await app.newsletter.collectAndDraft(issueId);
});
afterEach(() => app.close());

describe('subject A/B test (NWS-16)', () => {
  it('tests two subjects on a sample, waits, then sends the winner to everyone else', async () => {
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'Subject A', subjectB: 'Subject B', abSamplePercent: 20, abWaitHours: 4 } });
    await app.publishing.approve(issueId, 'staff-marketing_manager', null, new Date(Date.now() - 1000));
    await app.dispatcher.tick();

    const subjects = () => outbox.outbox.filter((m) => m.stream === 'marketing').map((m) => m.subject);
    expect(subjects().sort()).toEqual(['Subject A', 'Subject A', 'Subject B', 'Subject B']);
    const issue = await app.newsletter.require(issueId);
    const db = (await currentTestDatabase()).db;
    expect((await db.select().from(deliveries).where(and(eq(deliveries.sendId, issue.sendId!), eq(deliveries.status, 'held'))))).toHaveLength(16);
    expect((await app.sends.get(issue.sendId!))?.status).toBe('sending');

    // Both B readers click; nobody clicks A.
    const bRows = await db.select().from(deliveries).where(and(eq(deliveries.sendId, issue.sendId!), eq(deliveries.variant, 'B'), isNotNull(deliveries.sentAt)));
    for (const row of bRows) await db.update(deliveries).set({ firstClickAt: new Date() }).where(eq(deliveries.id, row.id));
    await app.dispatcher.tick();
    expect(subjects()).toHaveLength(4); // still waiting

    await db.update(sends).set({ abDecideAt: new Date(Date.now() - 1000) }).where(eq(sends.id, issue.sendId!));
    await app.dispatcher.tick();
    expect(subjects().filter((subject) => subject === 'Subject B')).toHaveLength(18);
    expect((await app.sends.get(issue.sendId!))).toMatchObject({ status: 'sent', abWinner: 'B' });

    await app.jobs.run('newsletter_schedule', 'test');
    const report = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/report`, headers: bearer('editor') })).json();
    expect(report.abTest).toMatchObject({ winner: 'B', variants: [{ variant: 'A', clicks: 0 }, { variant: 'B', clicks: 2 }] });
  });

  it('rejects a subject B equal to A', async () => {
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'Same', subjectB: 'Same' } });
    const checks = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/checks`, headers: bearer('editor') })).json().checks;
    expect(checks.find((check: { id: string }) => check.id === 'subject_b')).toMatchObject({ status: 'fail' });
  });
});
