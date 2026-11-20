/**
 * Academy Core Engine (Project 1) contract, as Marketing Hub consumes it (PRD 4.3, 6.1, 11.1, NFR-S1, NFR-S8).
 * Versioned: tolerate added fields, fail loudly on removed ones (PRD 11.3 rule 5).
 */
export const CORE_ENGINE_CONTRACT_VERSION = 'v1';

export type Language = 'hy' | 'en' | 'ru';

/** Lifecycle mirrored from the Core Engine; Marketing Hub does not invent its own (PRD 6.1). */
export type LifecycleStatus = 'lead' | 'applicant' | 'student' | 'alumnus';

/** Marketing Hub roles on top of the Core Engine role model (PRD 4.3). */
export type StaffRole = 'viewer' | 'editor' | 'marketing_manager' | 'admin' | 'leadership';

export type CorePerson = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  language: Language;
  lifecycleStatus: LifecycleStatus;
  updatedAt: string; // ISO 8601
};

export type CoreOutcomeType = 'enrolled' | 'completed';

export type CoreOutcome = {
  id: string;
  personId: string;
  type: CoreOutcomeType;
  courseId: string;
  /** Group (cohort) of the enrollment; added in v1.1, optional for older payloads. */
  groupId?: string | null;
  occurredAt: string;
};

/** A marketing touch written to the person record in the Core Engine (PRD 11.1, "Marketing Hub writes"). */
export type CoreMarketingTouch = {
  id: string;
  personId: string;
  type: string;
  channel: string | null;
  campaign: string | null;
  occurredAt: string;
};

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  roles: StaffRole[];
};

export type ActivityLogEntry = {
  actorId: string;
  /** e.g. consent.changed, contacts.exported, send.approved, key.rotated */
  action: string;
  subjectType: string;
  subjectId: string;
  reason?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export interface CoreEngineClient {
  readonly contractVersion: typeof CORE_ENGINE_CONTRACT_VERSION;
  /** Staff sign-in goes through the Core Engine; returns null for an invalid or expired token. */
  verifyStaffToken(token: string): Promise<StaffSession | null>;
  getPerson(personId: string): Promise<CorePerson | null>;
  findPersonByEmail(email: string): Promise<CorePerson | null>;
  listPeopleChangedSince(since: Date): Promise<CorePerson[]>;
  listOutcomesSince(since: Date): Promise<CoreOutcome[]>;
  writeActivityLog(entry: ActivityLogEntry): Promise<void>;
  /** Idempotent by touch ID: sending the same touch twice stores it once. */
  addMarketingTouches(touches: CoreMarketingTouch[]): Promise<void>;
}
