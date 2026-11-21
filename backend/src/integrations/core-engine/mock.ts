import {
  CORE_ENGINE_CONTRACT_VERSION,
  type ActivityLogEntry,
  type CoreEngineClient,
  type CoreGraduation,
  type CoreMarketingTouch,
  type CoreOutcome,
  type CorePerson,
  type StaffRole,
  type StaffSession,
} from './contract.js';

/** Synthetic people only (PRD 14.4: never real contacts outside production). */
const PEOPLE: CorePerson[] = [
  { id: 'core-p-001', email: 'ani.student@example.test', firstName: 'Ani', lastName: 'Sample', phone: null, language: 'hy', lifecycleStatus: 'student', updatedAt: '2026-10-01T09:00:00.000Z' },
  { id: 'core-p-002', email: 'davit.alumnus@example.test', firstName: 'Davit', lastName: 'Sample', phone: '+37400000002', language: 'en', lifecycleStatus: 'alumnus', updatedAt: '2026-09-15T09:00:00.000Z' },
  { id: 'core-p-003', email: 'maria.applicant@example.test', firstName: 'Maria', lastName: 'Sample', phone: null, language: 'ru', lifecycleStatus: 'applicant', updatedAt: '2026-11-02T09:00:00.000Z' },
];

const OUTCOMES: CoreOutcome[] = [
  { id: 'core-o-001', personId: 'core-p-001', type: 'enrolled', courseId: 'course-frontend', groupId: 'fe-2026-09', occurredAt: '2026-09-01T08:00:00.000Z' },
  { id: 'core-o-002', personId: 'core-p-002', type: 'completed', courseId: 'course-backend', groupId: 'be-2026-01', occurredAt: '2026-06-30T08:00:00.000Z' },
];

const ROLES: StaffRole[] = ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership'];

/** In mock mode a staff token is "mock-<role>", e.g. "mock-admin". */
export const mockStaffToken = (role: StaffRole) => `mock-${role}`;

export class MockCoreEngineClient implements CoreEngineClient {
  readonly contractVersion = CORE_ENGINE_CONTRACT_VERSION;
  /** Entries written by Marketing Hub, kept for inspection in tests. */
  readonly activityLog: ActivityLogEntry[] = [];

  /**
   * acceptStaffTokens=false rejects every "mock-<role>" token: the fixed tokens are public, so on a
   * deployed API they would let anyone act as admin (ALLOW_MOCK_SIGN_IN, off in production by default).
   */
  constructor(private readonly options: { acceptStaffTokens: boolean } = { acceptStaffTokens: true }) {}

  async verifyStaffToken(token: string): Promise<StaffSession | null> {
    if (!this.options.acceptStaffTokens) return null;
    const role = ROLES.find((candidate) => token === mockStaffToken(candidate));
    if (!role) return null;
    return { userId: `staff-${role}`, email: `${role}@staff.example.test`, name: `Mock ${role}`, roles: [role] };
  }

  async getPerson(personId: string): Promise<CorePerson | null> {
    return PEOPLE.find((person) => person.id === personId) ?? null;
  }

  async findPersonByEmail(email: string): Promise<CorePerson | null> {
    const normalized = email.trim().toLowerCase();
    return PEOPLE.find((person) => person.email === normalized) ?? null;
  }

  async listPeopleChangedSince(since: Date): Promise<CorePerson[]> {
    return PEOPLE.filter((person) => new Date(person.updatedAt) >= since);
  }

  async listOutcomesSince(since: Date): Promise<CoreOutcome[]> {
    return OUTCOMES.filter((outcome) => new Date(outcome.occurredAt) >= since);
  }

  async listGraduationsSince(since: Date): Promise<CoreGraduation[]> {
    const graduations: CoreGraduation[] = [
      { groupId: 'fe-2026-05', courseId: 'course-frontend', courseTitle: 'Frontend Development', graduatedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), graduates: 21 },
    ];
    return graduations.filter((graduation) => new Date(graduation.graduatedAt) >= since);
  }

  async writeActivityLog(entry: ActivityLogEntry): Promise<void> {
    this.activityLog.push(entry);
  }

  /** Touches written by Marketing Hub, by ID (idempotent like the real API). */
  readonly touches = new Map<string, CoreMarketingTouch>();

  async addMarketingTouches(touches: CoreMarketingTouch[]): Promise<void> {
    for (const touch of touches) this.touches.set(touch.id, touch);
  }
}
