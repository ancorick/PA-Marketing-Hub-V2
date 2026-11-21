import {
  ALUMNI_TRACKER_CONTRACT_VERSION,
  type AlumniTrackerClient,
  type EmploymentRecord,
  type Referral,
} from './contract.js';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** Dated relative to today so the newsletter "Alumni hires" collector always has a period to look at. */
const EMPLOYMENT: EmploymentRecord[] = [
  { corePersonId: 'core-p-002', status: 'employed', company: 'Example Tech LLC', role: 'Junior Backend Developer', inTech: true, startDate: daysAgo(15).toISOString().slice(0, 10), featureConsent: true, updatedAt: daysAgo(10).toISOString() },
  // Did not agree to be featured: collected, but skipped by the publish rule (PRD 8.2).
  { corePersonId: 'core-p-003', status: 'employed', company: 'Sample Studio', role: 'QA Intern', inTech: true, startDate: daysAgo(6).toISOString().slice(0, 10), featureConsent: false, updatedAt: daysAgo(5).toISOString() },
];

const REFERRALS: Referral[] = [
  { referrerPersonId: 'core-p-002', referredEmail: 'gor.lead@example.test', occurredAt: '2026-11-09T18:00:00.000Z' },
];

export class MockAlumniTrackerClient implements AlumniTrackerClient {
  readonly contractVersion = ALUMNI_TRACKER_CONTRACT_VERSION;

  async listEmploymentChangedSince(since: Date): Promise<EmploymentRecord[]> {
    return EMPLOYMENT.filter((record) => new Date(record.updatedAt) >= since);
  }

  async listReferralsSince(since: Date): Promise<Referral[]> {
    return REFERRALS.filter((referral) => new Date(referral.occurredAt) >= since);
  }
}
