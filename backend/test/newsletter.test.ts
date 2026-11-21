import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../src/db/schema.js';
import { createIntegrations, type Integrations } from '../src/integrations/index.js';
import { minusWorkingDays, monthlySendAt } from '../src/newsletter/service.js';
import { bearer, buildTestApp, currentTestDatabase, testConfig } from './helpers.js';

const DAY = 86_400_000;
let app: FastifyInstance;
let integrations: Integrations;

beforeEach(async () => {
  integrations = createIntegrations('mock');
  app = await buildTestApp({ integrations, config: testConfig({ ADMISSIONS_URL: 'https://academy.example/admissions' }) });
});
afterEach(() => app.close());

const days = (offset: number) => new Date(Date.now() + offset * DAY);

async function seedEvents() {
  const db = (await currentTestDatabase()).db;
  await db.insert(events).values([
    { title: 'Open day: Python', type: 'open_day', startsAt: days(10), public: true, registrationOpen: true, registrationUrl: 'https://events.example/open-day' },
    { title: 'Frontend meetup', type: 'meetup', startsAt: days(20), public: true, registrationOpen: true, registrationUrl: 'https://events.example/meetup' },
    { title: 'Career fair', type: 'other', startsAt: days(30), public: true, registrationOpen: true, registrationUrl: 'https://events.example/fair' },
    { title: 'Staff training', type: 'other', startsAt: days(12), public: false, registrationOpen: true, registrationUrl: 'https://events.example/staff' },
    { title: 'Hackathon recap', type: 'other', startsAt: days(-7), public: true, mediaPublic: true, recordingUrl: 'https://video.example/hackathon' },
  ]);
}

async function cadence(languages = ['hy', 'en']) {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/newsletter/cadences',
      headers: bearer('marketing_manager'),
      payload: { name: 'Monthly newsletter', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages, segments: {}, active: true },
    })
  ).json();
}

describe('schedule (NWS-01, NWS-06)', () => {
  it('computes the send moment in Yerevan time and goes back working days', () => {
    expect(monthlySendAt(2026, 11, 10, 11).toISOString()).toBe('2026-12-10T07:00:00.000Z');
    // Thursday 10 Dec 2026 minus five working days = Thursday 3 Dec.
    expect(minusWorkingDays(new Date('2026-12-10T07:00:00Z'), 5).toISOString().slice(0, 10)).toBe('2026-12-03');
  });

  it('plans one issue per language for the next edition, once', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/newsletter/cadences', headers: bearer('editor'), payload: {} })).statusCode).toBe(403);
    await cadence(['hy', 'en', 'ru']);
    await app.newsletter.schedule();
    const issues = (await app.inject({ method: 'GET', url: '/api/newsletter/issues', headers: bearer('editor') })).json().issues;
    expect(issues.map((issue: { language: string }) => issue.language).sort()).toEqual(['en', 'hy', 'ru']);
    expect(issues[0]).toMatchObject({ status: 'collecting', edition: expect.stringMatching(/^\d{4}-\d{2}$/) });
    expect(new Date(issues[0].collectAt) < new Date(issues[0].plannedSendAt)).toBe(true);
  });
});

describe('collectors and the draft (NWS-02, NWS-03, story NWS-S1)', () => {
  it('fills each block from its source, links every item to its record and lists skipped items with the reason', async () => {
    await seedEvents();
    await cadence();
    await app.newsletter.schedule();
    const hy = (await app.newsletter.list()).find((issue) => issue.language === 'hy')!;
    const drafted = await app.inject({ method: 'POST', url: `/api/newsletter/issues/${hy.id}/collect`, headers: bearer('editor') });
    expect(drafted.json()).toMatchObject({ status: 'draft', subject: expect.stringContaining('Picsart Academy') });

    const { blocks, items } = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${hy.id}`, headers: bearer('editor') })).json();
    const types = blocks.map((block: { type: string }) => block.type);
    expect(types[0]).toBe('lead');
    expect(types.at(-1)).toBe('cta');
    expect(types).toEqual(expect.arrayContaining(['upcoming_events', 'library', 'new_groups', 'hires', 'recent_events']));
    expect(blocks.find((b: { type: string }) => b.type === 'library').body).toContain('Git branch-երը');
    expect(blocks.find((b: { type: string }) => b.type === 'cta')).toMatchObject({ buttonUrl: 'https://academy.example/admissions' });

    const skipped = items.filter((item: { publishable: boolean }) => !item.publishable).map((item: { skipReason: string }) => item.skipReason);
    expect(skipped).toEqual(
      expect.arrayContaining(['Event is not public', 'Resource is not public', 'Link is not HTTPS', 'Graduate did not agree to be featured', 'Group is not open for applications']),
    );
    // No one is named without consent.
    expect(JSON.stringify(blocks)).not.toContain('Maria');
    expect(JSON.stringify(blocks)).toContain('Davit S.');
    for (const item of items) expect(item.sourceRef).toBeTruthy();
  });

  it('drafts on schedule and keeps going when one source is down', async () => {
    await cadence(['en']);
    await app.newsletter.schedule();
    vi.spyOn(integrations.library, 'listResourcesAddedSince').mockRejectedValueOnce(new Error('Library 500'));
    const issue = (await app.newsletter.list())[0]!;
    // Pretend the collect moment has come.
    const db = (await currentTestDatabase()).db;
    const { issues } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db.update(issues).set({ collectAt: new Date(Date.now() - 1000) }).where(eq(issues.id, issue.id));
    await app.jobs.run('newsletter_schedule', 'test');
    const after = await app.newsletter.require(issue.id);
    expect(after.status).toBe('draft');
    const blocks = await app.newsletter.blocks(issue.id);
    expect(blocks.some((block) => block.type === 'library')).toBe(false);
    expect(blocks.some((block) => block.type === 'graduations' || block.type === 'lead')).toBe(true);
  });
});
