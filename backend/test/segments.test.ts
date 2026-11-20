import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleContactRepository, type NewContact } from '../src/contacts/repository.js';
import { consentRecords, outcomes, touchpoints } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

async function seed(email: string, extra: Partial<NewContact> & Record<string, unknown> = {}) {
  const repo = new DrizzleContactRepository((await currentTestDatabase()).db);
  const contact = await repo.insert(
    { corePersonId: null, email, phone: null, firstName: null, lastName: null, language: 'hy', type: 'subscriber', sourceChannel: 'events', sourceCampaign: null, firstTouchAt: daysAgo(400), tags: [], ...extra } as NewContact,
    'test',
  );
  const { crmStage, employmentStatus } = extra as { crmStage?: string; employmentStatus?: string };
  if (crmStage || employmentStatus) await repo.update(contact.id, { crmStage, employmentStatus }, 'test');
  return contact;
}
const db = async () => (await currentTestDatabase()).db;
const touch = async (contactId: string, type: string, at: Date, campaign: string | null = null) =>
  (await db()).insert(touchpoints).values({ contactId, type, occurredAt: at, channel: 'events', campaign, sourceSystem: 'test', sourceRef: null });
const outcome = async (contactId: string, type: string, courseId: string | null = null, at = daysAgo(10)) =>
  (await db()).insert(outcomes).values({ contactId, type, occurredAt: at, courseId, sourceSystem: 'test', sourceRef: `${contactId}:${type}` });
const consent = async (contactId: string, topic: string, state: string, at = new Date()) =>
  (await db()).insert(consentRecords).values({ contactId, topic, state, method: 'form', createdAt: at });

const count = async (rule: unknown) => {
  const response = await app.inject({ method: 'POST', url: '/api/audience/segments/count', headers: bearer('editor'), payload: { rule } });
  return response;
};
const emailsOf = async (rule: unknown) => ((await count(rule)).json().sample as { email: string }[]).map((c) => c.email).sort();

describe('segment rules: the 6.4 examples (AUD-13)', () => {
  it('open day attendees, not applied', async () => {
    const a = await seed('attended@example.test');
    const b = await seed('applied@example.test', { type: 'lead', crmStage: 'applied' });
    const c = await seed('old@example.test');
    const d = await seed('workshop@example.test');
    await touch(a.id, 'attendance', daysAgo(20), 'open_day_2026_10');
    await touch(b.id, 'attendance', daysAgo(20), 'open_day_2026_10');
    await touch(c.id, 'attendance', daysAgo(200), 'open_day_2025_10');
    await touch(d.id, 'attendance', daysAgo(5), 'python_workshop');
    const rule = {
      op: 'and',
      conditions: [
        { kind: 'touch', touchType: 'attendance', operator: 'did', withinDays: 90, campaignContains: 'open_day' },
        { kind: 'attribute', field: 'type', operator: 'in', values: ['subscriber', 'lead'] },
        { kind: 'admissions', operator: 'not_active' },
      ],
    };
    expect(await emailsOf(rule)).toEqual(['attended@example.test']);
  });

  it('alumni, Python track, hired', async () => {
    const a = await seed('py.hired@example.test', { type: 'alumnus', employmentStatus: 'employed' });
    const b = await seed('py.seeking@example.test', { type: 'alumnus', employmentStatus: 'seeking' });
    const c = await seed('fe.hired@example.test', { type: 'alumnus', employmentStatus: 'employed' });
    await outcome(a.id, 'completed', 'course-python-backend');
    await outcome(b.id, 'completed', 'course-python-backend');
    await outcome(c.id, 'completed', 'course-frontend');
    const rule = {
      op: 'and',
      conditions: [
        { kind: 'attribute', field: 'type', operator: 'in', values: ['alumnus'] },
        { kind: 'course', operator: 'contains', values: ['python'] },
        { kind: 'attribute', field: 'employmentStatus', operator: 'in', values: ['employed'] },
      ],
    };
    expect(await emailsOf(rule)).toEqual(['py.hired@example.test']);
  });

  it('Armenian-language newsletter, and re-engagement', async () => {
    const hy = await seed('hy@example.test');
    const en = await seed('en@example.test', { language: 'en' });
    const quiet = await seed('quiet@example.test');
    const withdrawn = await seed('gone@example.test');
    await consent(hy.id, 'newsletter', 'granted', daysAgo(10));
    await consent(en.id, 'newsletter', 'granted', daysAgo(300));
    await consent(quiet.id, 'newsletter', 'granted', daysAgo(400));
    await consent(withdrawn.id, 'newsletter', 'granted', daysAgo(400));
    await consent(withdrawn.id, 'newsletter', 'withdrawn', daysAgo(5));
    await touch(en.id, 'click', daysAgo(30));
    expect(await emailsOf({ op: 'and', conditions: [{ kind: 'consent', topic: 'newsletter', state: 'granted' }, { kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] })).toEqual([
      'hy@example.test',
      'quiet@example.test',
    ]);
    const reengagement = {
      op: 'and',
      conditions: [
        { kind: 'consent', topic: 'newsletter', state: 'granted', olderThanDays: 180 },
        { kind: 'touch', touchType: 'open', operator: 'did_not', withinDays: 120 },
        { kind: 'touch', touchType: 'click', operator: 'did_not', withinDays: 120 },
      ],
    };
    expect(await emailsOf(reengagement)).toEqual(['quiet@example.test']);
  });

  it('referral champions: referred at least one enrolled student', async () => {
    const champion = await seed('champion@example.test', { type: 'alumnus' });
    const other = await seed('other@example.test', { type: 'alumnus' });
    const referred = await seed('friend@example.test', { type: 'student' });
    await (await db()).insert(touchpoints).values([
      { contactId: champion.id, type: 'referral', occurredAt: daysAgo(30), channel: 'referrals', sourceSystem: 'alumni_tracker', sourceRef: 'friend@example.test' },
      { contactId: other.id, type: 'referral', occurredAt: daysAgo(30), channel: 'referrals', sourceSystem: 'alumni_tracker', sourceRef: 'nobody@example.test' },
    ]);
    await outcome(referred.id, 'enrolled', 'course-frontend');
    expect(await emailsOf({ op: 'or', conditions: [{ kind: 'referred_enrolled' }] })).toEqual(['champion@example.test']);
  });
});

describe('segment safety (NFR-S7)', () => {
  it('rejects anything outside the rule whitelist and treats values as data', async () => {
    await seed('x@example.test', { tags: ["'; drop table contacts; --"] });
    expect((await count({ op: 'and', conditions: [{ kind: 'attribute', field: 'email', operator: 'in', values: ['x'] }] })).statusCode).toBe(400);
    expect((await count({ op: 'and', conditions: [{ kind: 'raw', sql: 'true' }] })).statusCode).toBe(400);
    expect((await count({ op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ["hy' or '1'='1"] }] })).statusCode).toBe(400);
    const tagged = await count({ op: 'and', conditions: [{ kind: 'tag', operator: 'has', value: "'; drop table contacts; --" }] });
    expect(tagged.json().count).toBe(1);
    const deep = { op: 'and', conditions: [{ op: 'or', conditions: [{ op: 'and', conditions: [{ op: 'or', conditions: [{ kind: 'referred_enrolled' }] }] }] }] };
    expect((await count(deep)).json().message).toMatch(/three levels/);
  });
});

describe('dynamic and static segments, send audience (AUD-14, AUD-15, AUD-17)', () => {
  it('recalculates a saved dynamic segment and breaks down who would receive a send', async () => {
    const rule = { op: 'and', conditions: [{ kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] }] };
    const created = (await app.inject({ method: 'POST', url: '/api/audience/segments', headers: bearer('editor'), payload: { name: 'Armenian', type: 'dynamic', rule } })).json();
    expect(created.lastCount).toBe(0);

    const ok = await seed('ok@example.test');
    const noConsent = await seed('noconsent@example.test');
    const applicant = await seed('applicant@example.test', { crmStage: 'interview' });
    const unsubscribed = await seed('unsub@example.test');
    await seed('english@example.test', { language: 'en' });
    for (const contact of [ok, applicant, unsubscribed]) await consent(contact.id, 'courses', 'granted');
    await app.consent.unsubscribeAll(unsubscribed.id, 'link', { kind: 'person' });
    void noConsent;

    const breakdown = (await app.inject({ method: 'GET', url: `/api/audience/segments/${created.id}/breakdown?topic=courses`, headers: bearer('editor') })).json();
    expect(breakdown).toEqual({ matching: 4, notReachable: 1, noConsent: 1, activeAdmissions: 1, eligible: 1 });
    const audience = await app.segments.audience(created.id, { topic: 'courses', excludeActiveAdmissions: false });
    expect(audience.map((c) => c.email).sort()).toEqual(['applicant@example.test', 'ok@example.test']);
  });

  it('keeps hand-picked members in static lists', async () => {
    const list = (await app.inject({ method: 'POST', url: '/api/audience/segments', headers: bearer('editor'), payload: { name: 'Gala guests', type: 'static' } })).json();
    const a = await seed('guest1@example.test');
    await seed('guest2@example.test');
    const added = await app.inject({
      method: 'POST',
      url: `/api/audience/segments/${list.id}/members`,
      headers: bearer('editor'),
      payload: { emails: ['Guest2@example.test', 'missing@example.test'], contactIds: [a.id] },
    });
    expect(added.json()).toEqual({ added: 2, notFound: ['missing@example.test'] });
    const members = (await app.inject({ method: 'GET', url: `/api/audience/segments/${list.id}/members`, headers: bearer('editor') })).json();
    expect(members.total).toBe(2);
    await app.inject({ method: 'DELETE', url: `/api/audience/segments/${list.id}/members`, headers: bearer('editor'), payload: { contactIds: [a.id] } });
    expect((await app.segments.get(list.id))?.lastCount).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/audience/segments', headers: bearer('viewer') })).statusCode).toBe(403);
  });

  it('counts a segment of 50,000 contacts in under 3 seconds (NFR-F2)', async () => {
    const repo = new DrizzleContactRepository(await db());
    const languages = ['hy', 'en', 'ru'] as const;
    for (let i = 0; i < 50_000; i += 2500) {
      await repo.insertMany(
        Array.from({ length: 2500 }, (_, j) => ({
          corePersonId: null,
          email: `p${i + j}@example.test`,
          phone: null,
          firstName: null,
          lastName: null,
          language: languages[(i + j) % 3]!,
          type: 'subscriber' as const,
          sourceChannel: 'events',
          sourceCampaign: null,
          firstTouchAt: daysAgo((i + j) % 700),
          tags: (i + j) % 7 === 0 ? ['python'] : [],
        })),
        'test',
      );
    }
    const rule = {
      op: 'and',
      conditions: [
        { kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] },
        { kind: 'tag', operator: 'has', value: 'python' },
        { kind: 'touch', touchType: 'click', operator: 'did_not', withinDays: 120 },
        { kind: 'consent', topic: 'newsletter', state: 'unknown' },
      ],
    };
    const started = Date.now();
    const response = await count(rule);
    expect(response.json().count).toBeGreaterThan(2000);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 120_000);
});
