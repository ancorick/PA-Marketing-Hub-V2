import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { contrastRatio } from '../src/newsletter/publishing.js';
import { bearer, buildTestApp, FakeDns, publishPlaceholderRecords, testConfig } from './helpers.js';

const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let outbox: LogEmailAdapter;
let issueId: string;
let cadenceId: string;
let segmentId: string;
let linkStatus: Record<string, number>;

const template = { name: 'Brand', accentColor: '#FFDC00', buttonTextColor: '#131317', backgroundColor: '#F6F5FA', textColor: '#121216', fontFamily: 'Manrope, Arial, sans-serif', logoUrl: null, headerText: 'Picsart Academy', footerNote: 'You are part of the Academy community.' };

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  linkStatus = {};
  const dns = new FakeDns();
  app = await buildTestApp({
    email: outbox,
    dnsResolver: dns,
    sleep: async () => {},
    linkChecker: { status: async (url) => linkStatus[url] ?? 200, contentLength: async () => 2048 },
    config: testConfig({ MAIL_FROM: `Picsart Academy <news@${DOMAIN}>`, ADMISSIONS_URL: 'https://academy.example/admissions' }),
  });
  publishPlaceholderRecords(dns, DOMAIN);
  const domain = await app.domains.add(DOMAIN, { userId: 'staff-admin' });
  await app.domains.verify(domain.id);
  await app.domains.updateWarmup(domain.id, { skip: true }, { userId: 'staff-admin' });

  for (const email of ['reader1@example.test', 'reader2@example.test']) {
    const contact = (await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email, language: 'hy', sourceChannel: 'events' } })).json();
    await app.consent.record(contact.id, { topics: ['newsletter'], state: 'granted', method: 'form' }, { kind: 'person' });
  }
  await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: 'noconsent@example.test', language: 'hy', sourceChannel: 'events' } });
  segmentId = (await app.segments.create({ name: 'Armenian newsletter', type: 'dynamic', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] } }, 'x')).id;
  const savedTemplate = (await app.inject({ method: 'POST', url: '/api/newsletter/templates', headers: bearer('marketing_manager'), payload: template })).json();
  const cadence = (
    await app.inject({
      method: 'POST',
      url: '/api/newsletter/cadences',
      headers: bearer('marketing_manager'),
      payload: { name: 'Monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['hy'], segments: { hy: segmentId }, templateId: savedTemplate.id, active: true },
    })
  ).json();
  cadenceId = cadence.id;
  issueId = (await app.newsletter.list())[0]!.id;
  await app.newsletter.collectAndDraft(issueId);
});
afterEach(() => app.close());

const post = (path: string, role: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/${path}`, headers: bearer(role), payload });
const checks = async () => (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/checks`, headers: bearer('editor') })).json().checks as { id: string; status: string }[];

describe('templates (NWS-15)', () => {
  it('keeps brand colours accessible', async () => {
    expect(contrastRatio('#131317', '#FFDC00')).toBeGreaterThan(4.5);
    const poor = await app.inject({ method: 'POST', url: '/api/newsletter/templates', headers: bearer('marketing_manager'), payload: { ...template, buttonTextColor: '#FFFFFF' } });
    expect(poor.json().message).toMatch(/contrast/);
    expect((await app.inject({ method: 'POST', url: '/api/newsletter/templates', headers: bearer('editor'), payload: template })).statusCode).toBe(403);
  });
});

describe('preview, checks and test send (NWS-08, NWS-09, NWS-14)', () => {
  it('renders blocks with the template and tags every link with its block', async () => {
    const preview = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/preview`, headers: bearer('editor') })).json();
    const blocks = await app.newsletter.blocks(issueId);
    expect(preview.html).toContain('You are part of the Academy community.');
    expect(preview.html).toContain(`utm_content=${blocks.find((block) => block.type === 'cta')!.id}`);
    expect(preview.html).toContain('utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=newsletter_');
    expect(preview.text).toContain(blocks[0]!.title.toUpperCase());

    const test = await post('test', 'editor', { emails: ['seed@academy.example'] });
    expect(test.json()).toEqual({ sent: 1 });
    expect(outbox.outbox.at(-1)!.subject).toMatch(/^\[Test\] /);
  });

  it('fails on a long subject, a broken link, a missing alt text or too much image weight', async () => {
    expect((await checks()).every((check) => check.status === 'pass')).toBe(true);
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'x'.repeat(71) } });
    linkStatus['https://academy.example/admissions'] = 404;
    const [first] = await app.newsletter.blocks(issueId);
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}/blocks/${first!.id}`, headers: bearer('editor'), payload: { body: `${first!.body}\n\n![](https://cdn.example/a.png)` } });
    const failing = (await checks()).filter((check) => check.status === 'fail').map((check) => check.id).sort();
    expect(failing).toEqual(['alt', 'links', 'subject']);
  });
});

describe('review, approval and sending (NWS-10, NWS-11, story NWS-S2)', () => {
  it('goes from draft to review to approved send, with comments, and sends to consented readers only', async () => {
    await post('submit', 'editor', { comment: 'Ready for a look' });
    expect((await post('approve', 'editor')).statusCode).toBe(403);
    await post('request-changes', 'marketing_manager', { comment: 'Shorter lead, please' });
    expect((await app.newsletter.require(issueId)).status).toBe('draft');
    await post('submit', 'editor');

    const approved = await post('approve', 'marketing_manager', { comment: 'Looks good', scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(approved.json()).toMatchObject({ issue: { status: 'scheduled' } });
    // Scheduled issues are locked; unscheduling sends it back for approval.
    expect((await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'Late change' } })).statusCode).toBe(409);
    await post('unschedule', 'marketing_manager');
    expect((await app.newsletter.require(issueId)).status).toBe('in_review');
    await post('approve', 'marketing_manager', { scheduledAt: new Date(Date.now() - 1000).toISOString() });

    await app.dispatcher.tick();
    const sent = outbox.outbox.filter((message) => message.stream === 'marketing');
    expect(sent.map((message) => message.to).sort()).toEqual(['reader1@example.test', 'reader2@example.test']);
    expect(sent[0]!.html).toContain('utm_content=');
    await app.jobs.run('newsletter_schedule', 'test');
    expect((await app.newsletter.require(issueId)).status).toBe('sent');

    const thread = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/comments`, headers: bearer('editor') })).json().comments;
    expect(thread.map((comment: { kind: string }) => comment.kind)).toEqual(['submitted', 'changes_requested', 'submitted', 'approved', 'unscheduled', 'approved']);
    expect(thread[1]).toMatchObject({ body: 'Shorter lead, please', actorId: 'staff-marketing_manager' });
    void cadenceId;
  });

  it('cannot be approved while a check fails', async () => {
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'x'.repeat(80) } });
    const response = await post('approve', 'marketing_manager');
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/Subject line/);
  });
});
