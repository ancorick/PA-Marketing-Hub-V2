import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { groupOfAnswer } from '../src/analytics/self-reported.js';
import { contacts, outcomes } from '../src/db/schema.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

describe('self-reported source vs tracked first touch (ANL-16)', () => {
  it('groups free-text answers in English, Russian and Armenian', () => {
    expect(groupOfAnswer('Instagram')).toBe('social');
    expect(groupOfAnswer('Увидел рекламу в инстаграме')).toBe('social');
    expect(groupOfAnswer('Ընկերս խորհուրդ տվեց')).toBe('referrals');
    expect(groupOfAnswer('A friend from the Academy, saw it on Instagram too')).toBe('referrals');
    expect(groupOfAnswer('Google')).toBe('search_website');
    expect(groupOfAnswer('День открытых дверей')).toBe('events');
    expect(groupOfAnswer('Newsletter')).toBe('email');
    expect(groupOfAnswer('Не помню')).toBeNull();
    expect(groupOfAnswer('  ')).toBeNull();
  });

  it('shows the agreement rate for applicants of the period, and what tracking misses', async () => {
    const app = await buildTestApp();
    const { db } = await currentTestDatabase();
    let seq = 0;
    const applicant = async (channel: 'paid_social' | 'events' | 'search_website', answer: string | null, tracked = true) => {
      seq += 1;
      const contact = await app.contacts.create({ email: `s${seq}@example.test`, language: 'ru', sourceChannel: channel, firstTouchAt: new Date('2026-09-01T10:00:00+04:00') }, { userId: 'test' });
      await db.update(contacts).set({ selfReportedSource: answer, ...(tracked ? {} : { sourceChannel: null }) }).where(eq(contacts.id, contact.id));
      await db.insert(outcomes).values({ contactId: contact.id, type: 'applied', occurredAt: new Date('2026-10-05T10:00:00+04:00'), sourceSystem: 'test', sourceRef: `a${seq}` });
    };
    await applicant('paid_social', 'Instagram'); // agrees
    await applicant('paid_social', 'инстаграм'); // agrees
    await applicant('paid_social', 'Instagram'); // agrees
    await applicant('events', 'A friend'); // disagrees
    await applicant('search_website', 'Google'); // agrees
    await applicant('paid_social', null); // no answer
    await applicant('events', 'Не помню'); // unrecognised
    await applicant('events', 'Друзья', false); // no tracked touch

    const response = await app.inject({ method: 'GET', url: '/api/analytics/self-reported?from=2026-10-01&to=2026-10-31', headers: bearer('marketing_manager') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ compared: 5, agreed: 4, agreementRate: 0.8, withoutAnswer: 1, unrecognisedAnswers: 1, untracked: 1 });
    expect(body.matrix).toEqual(expect.arrayContaining([{ reported: 'social', tracked: 'social', count: 3 }, { reported: 'referrals', tracked: 'events', count: 1 }]));

    const shared = (await app.inject({ method: 'GET', url: '/api/analytics/self-reported?from=2026-10-01&to=2026-10-31', headers: bearer('leadership') })).json();
    // One disagreement would reveal a single person: the rate is hidden too.
    expect(shared).toMatchObject({ compared: 5, agreed: 4, agreementRate: null, withoutAnswer: 'fewer_than_3' });
    await app.close();
  });
});
