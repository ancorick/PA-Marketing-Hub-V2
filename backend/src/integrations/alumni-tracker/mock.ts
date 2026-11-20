import {
  ALUMNI_TRACKER_CONTRACT_VERSION,
  type AlumniTrackerClient,
  type EmploymentRecord,
  type Referral,
} from './contract.js';

const EMPLOYMENT: EmploymentRecord[] = [
  { corePersonId: 'core-p-002', status: 'employed', company: 'Example Tech LLC', role: 'Junior Backend Developer', inTech: true, startDate: '2026-08-15', featureConsent: true, updatedAt: '2026-08-20T09:00:00.000Z' },
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
