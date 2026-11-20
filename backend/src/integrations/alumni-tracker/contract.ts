/**
 * Alumni Tracker (Project 11) contract, as Marketing Hub consumes it (PRD 11.1). Read-only.
 * Self-reported by graduates; no LinkedIn scraping.
 */
export const ALUMNI_TRACKER_CONTRACT_VERSION = 'v1';

export type EmploymentStatus = 'employed' | 'seeking' | 'not_seeking';

export type EmploymentRecord = {
  corePersonId: string;
  status: EmploymentStatus;
  company: string | null;
  role: string | null;
  /** Whether the role counts as a tech role; the "hired" definition is open (PRD 16.3, question 6). */
  inTech: boolean | null;
  startDate: string | null; // YYYY-MM-DD
  /** Graduate agreed to be featured in marketing (newsletter "hires" block). */
  featureConsent: boolean;
  updatedAt: string;
};

export type Referral = {
  referrerPersonId: string;
  referredEmail: string;
  occurredAt: string;
};

export interface AlumniTrackerClient {
  readonly contractVersion: typeof ALUMNI_TRACKER_CONTRACT_VERSION;
  listEmploymentChangedSince(since: Date): Promise<EmploymentRecord[]>;
  listReferralsSince(since: Date): Promise<Referral[]>;
}
