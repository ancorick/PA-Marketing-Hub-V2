import { describe, expect, it } from 'vitest';
import { createIntegrations } from '../src/integrations/index.js';
import { mockStaffToken } from '../src/integrations/core-engine/mock.js';

/**
 * Contract tests (PRD 11.3 rule 6). Today they run against the mocks; the same suite
 * will run against recorded fixtures of the real Projects 1, 2 and 11.
 */
const EPOCH = new Date(0);
const isIso = (value: string) => !Number.isNaN(Date.parse(value));

describe('Core Engine contract (Project 1)', () => {
  const { coreEngine } = createIntegrations('mock');

  it('exposes contract version v1', () => {
    expect(coreEngine.contractVersion).toBe('v1');
  });

  it('verifies staff tokens and maps them to Marketing Hub roles', async () => {
    await expect(coreEngine.verifyStaffToken(mockStaffToken('marketing_manager'))).resolves.toMatchObject({
      roles: ['marketing_manager'],
    });
    await expect(coreEngine.verifyStaffToken('forged')).resolves.toBeNull();
  });

  it('returns people with normalized emails and a known lifecycle status', async () => {
    const people = await coreEngine.listPeopleChangedSince(EPOCH);
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.email).toBe(person.email.trim().toLowerCase());
      expect(['lead', 'applicant', 'student', 'alumnus']).toContain(person.lifecycleStatus);
      expect(['hy', 'en', 'ru']).toContain(person.language);
      expect(isIso(person.updatedAt)).toBe(true);
    }
    const first = people[0]!;
    await expect(coreEngine.findPersonByEmail(` ${first.email.toUpperCase()} `)).resolves.toEqual(first);
    await expect(coreEngine.getPerson('missing')).resolves.toBeNull();
  });

  it('filters by the since parameter', async () => {
    await expect(coreEngine.listPeopleChangedSince(new Date('2100-01-01'))).resolves.toEqual([]);
    await expect(coreEngine.listOutcomesSince(new Date('2100-01-01'))).resolves.toEqual([]);
  });

  it('accepts activity log entries', async () => {
    await expect(
      coreEngine.writeActivityLog({
        actorId: 'staff-admin',
        action: 'contacts.exported',
        subjectType: 'segment',
        subjectId: 'seg-1',
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Navigator CRM contract (Project 2)', () => {
  const { navigatorCrm } = createIntegrations('mock');

  it('lists leads and stage changes with ISO timestamps', async () => {
    const leads = await navigatorCrm.listLeadsChangedSince(EPOCH);
    expect(leads.length).toBeGreaterThan(0);
    for (const lead of leads) expect(isIso(lead.updatedAt)).toBe(true);
    const changes = await navigatorCrm.listStageChangesSince(EPOCH);
    expect(changes.every((change) => isIso(change.occurredAt))).toBe(true);
  });

  it('creates a lead in stage "new" with the marketing channel', async () => {
    const { id } = await navigatorCrm.createLead({
      email: ' New.Lead@Example.test ',
      firstName: 'New',
      lastName: 'Lead',
      channel: 'newsletter',
    });
    const leads = await navigatorCrm.listLeadsChangedSince(EPOCH);
    expect(leads.find((lead) => lead.id === id)).toMatchObject({
      email: 'new.lead@example.test',
      stage: 'new',
      sourceChannel: 'newsletter',
    });
  });
});

describe('Alumni Tracker contract (Project 11)', () => {
  const { alumniTracker } = createIntegrations('mock');

  it('lists employment records and referrals', async () => {
    const employment = await alumniTracker.listEmploymentChangedSince(EPOCH);
    expect(employment.length).toBeGreaterThan(0);
    for (const record of employment) {
      expect(['employed', 'seeking', 'not_seeking']).toContain(record.status);
      expect(typeof record.featureConsent).toBe('boolean');
    }
    const referrals = await alumniTracker.listReferralsSince(EPOCH);
    expect(referrals.every((referral) => isIso(referral.occurredAt))).toBe(true);
  });
});
