import type { ContactStatus } from '../contacts/fields.js';
import { hashEmail } from '../contacts/fields.js';
import type { Contact, ContactRepository } from '../contacts/repository.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import type { ConsentRecord, ConsentRepository, Suppression, SuppressionReason } from './repository.js';
import { findWording, TOPICS, type ConsentMethod, type ConsentState, type Topic } from './wordings.js';

/** A consent change that breaks a rule of PRD 6.3 or AUD-12. */
export class ConsentRuleError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConsentRuleError';
  }
}

export type ConsentChange = {
  topics: Topic[];
  state: ConsentState;
  method: ConsentMethod;
  wordingVersion?: string | null;
  sourceUrl?: string | null;
  ip?: string | null;
  reason?: string | null;
};

/** Who made the change: staff (manual) or the person themselves through a signed link or form. */
export type ConsentActor = { kind: 'staff'; userId: string } | { kind: 'person' } | { kind: 'system'; name: string };

export type TopicConsent = {
  topic: Topic;
  state: ConsentState;
  method: ConsentMethod | null;
  wordingVersion: string | null;
  since: string | null;
};

export type ConsentView = {
  topics: TopicConsent[];
  suppressed: { reason: SuppressionReason; source: string; since: string }[];
  history: {
    id: string;
    topic: Topic;
    state: ConsentState;
    method: ConsentMethod;
    wordingVersion: string | null;
    sourceUrl: string | null;
    actorId: string | null;
    reason: string | null;
    at: string;
  }[];
};

type ConsentServiceDeps = {
  consent: ConsentRepository;
  contacts: Pick<ContactRepository, 'findById' | 'findByEmail' | 'update'>;
  coreEngine: Pick<CoreEngineClient, 'writeActivityLog'>;
  logger: { error: (obj: object, msg: string) => void };
  now?: () => Date;
};

const UNSUBSCRIBE_REASON = 'Unsubscribed from all marketing';

/** The most serious active suppression decides the marketing status; none = active. */
export function statusFromSuppressions(active: Pick<Suppression, 'reason'>[]): ContactStatus {
  const reasons = new Set(active.map((row) => row.reason));
  if (reasons.has('erased')) return 'erased';
  if (reasons.has('complaint')) return 'complained';
  if (reasons.has('hard_bounce')) return 'bounced';
  if (reasons.has('unsubscribed')) return 'unsubscribed';
  return 'active';
}

const actorId = (actor: ConsentActor) => (actor.kind === 'staff' ? actor.userId : actor.kind === 'system' ? actor.name : null);

/**
 * Consent per contact and topic (AUD-07) and the global suppression list (AUD-12), with the rules of 6.3:
 * the most restrictive state wins, an unsubscribe recorded anywhere beats any later import or staff change,
 * and staff change consent only with a reason that goes to the Core Engine activity log.
 */
export class ConsentService {
  private readonly now: () => Date;

  constructor(private readonly deps: ConsentServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async view(contactId: string): Promise<ConsentView | null> {
    const contact = await this.deps.contacts.findById(contactId);
    if (!contact) return null;
    const [history, active] = await Promise.all([
      this.deps.consent.history(contactId),
      contact.email ? this.deps.consent.active(hashEmail(contact.email)) : Promise.resolve([]),
    ]);
    const latest = new Map<Topic, ConsentRecord>();
    for (const row of history) if (!latest.has(row.topic)) latest.set(row.topic, row);
    return {
      topics: TOPICS.map((topic) => {
        const row = latest.get(topic);
        return {
          topic,
          // 6.3 rule 2: no record at all is unknown consent.
          state: row?.state ?? 'unknown',
          method: row?.method ?? null,
          wordingVersion: row?.wordingVersion ?? null,
          since: row?.createdAt.toISOString() ?? null,
        };
      }),
      suppressed: active.map((row) => ({ reason: row.reason, source: row.source, since: row.createdAt.toISOString() })),
      history: history.map((row) => ({
        id: row.id,
        topic: row.topic,
        state: row.state,
        method: row.method,
        wordingVersion: row.wordingVersion,
        sourceUrl: row.sourceUrl,
        actorId: row.actorId,
        reason: row.reason,
        at: row.createdAt.toISOString(),
      })),
    };
  }

  /** Current state per topic; topics without a record are unknown. */
  async current(contactId: string): Promise<Record<Topic, ConsentState>> {
    const latest = await this.deps.consent.latest(contactId);
    return Object.fromEntries(TOPICS.map((topic) => [topic, latest.get(topic)?.state ?? 'unknown'])) as Record<Topic, ConsentState>;
  }

  /** Marketing status for an address that is about to get a contact record (imports, sign-ups). */
  async statusForEmail(email: string): Promise<ContactStatus> {
    return statusFromSuppressions(await this.deps.consent.active(hashEmail(email)));
  }

  async isSuppressed(email: string): Promise<boolean> {
    return (await this.deps.consent.active(hashEmail(email))).length > 0;
  }

  /**
   * Records a consent change for one or more topics. Returns the records written; an import that would
   * override a withdrawal or a suppression is skipped (returns []), as 6.3 rule 3 requires.
   */
  async record(contactId: string, change: ConsentChange, actor: ConsentActor): Promise<ConsentRecord[]> {
    const contact = await this.requireContact(contactId);
    this.validate(change, actor);

    const active = contact.email ? await this.deps.consent.active(hashEmail(contact.email)) : [];
    if (change.state === 'granted' || change.state === 'pending') {
      if (active.length > 0 && actor.kind !== 'person') {
        if (change.method === 'import') return [];
        throw new ConsentRuleError(
          'state',
          `This address is on the suppression list (${active.map((row) => row.reason).join(', ')}); only the person can opt in again`,
        );
      }
      if (change.method === 'import') {
        // Most restrictive wins: an import never turns a withdrawal back into consent.
        const latest = await this.deps.consent.latest(contactId);
        const topics = change.topics.filter((topic) => latest.get(topic)?.state !== 'withdrawn');
        if (topics.length === 0) return [];
        change = { ...change, topics };
      }
    }

    const records = await this.deps.consent.insert(
      change.topics.map((topic) => ({
        contactId,
        topic,
        state: change.state,
        method: change.method,
        wordingVersion: change.wordingVersion ?? null,
        sourceUrl: change.sourceUrl ?? null,
        ip: change.ip ?? null,
        actorId: actorId(actor),
        reason: change.reason ?? null,
      })),
    );

    // The person's own confirmed opt-in lifts their earlier unsubscribe (never a bounce or complaint).
    if (change.state === 'granted' && actor.kind === 'person' && contact.email) {
      if (await this.deps.consent.liftUnsubscribe(hashEmail(contact.email), change.method)) await this.syncStatus(contact, 'person');
    }
    if (change.method === 'manual' && actor.kind === 'staff') {
      await this.log(actor.userId, 'consent.changed', contactId, change.reason ?? undefined, {
        topics: change.topics,
        state: change.state,
      });
    }
    return records;
  }

  /**
   * One-click unsubscribe from all marketing (AUD-09, Flow E): suppression first, so no send can pick
   * the address up, then a withdrawal per topic. Repeating it changes nothing.
   */
  async unsubscribeAll(
    contactId: string,
    source: 'link' | 'list_unsubscribe' | 'preferences' | 'manual' | 'complaint',
    actor: ConsentActor,
    meta: { ip?: string | null; reason?: string } = {},
  ): Promise<void> {
    const contact = await this.requireContact(contactId);
    if (contact.email) {
      const hash = hashEmail(contact.email);
      const active = await this.deps.consent.active(hash);
      if (!active.some((row) => row.reason === 'unsubscribed')) await this.deps.consent.suppress(hash, 'unsubscribed', source);
    }
    const latest = await this.deps.consent.latest(contactId);
    const topics = TOPICS.filter((topic) => latest.get(topic)?.state !== 'withdrawn');
    await this.deps.consent.insert(
      topics.map((topic) => ({
        contactId,
        topic,
        state: 'withdrawn' as const,
        method: source === 'manual' ? ('manual' as const) : ('link' as const),
        wordingVersion: null,
        sourceUrl: null,
        ip: meta.ip ?? null,
        actorId: actorId(actor),
        reason: meta.reason ?? UNSUBSCRIBE_REASON,
      })),
    );
    await this.syncStatus(contact, actorId(actor) ?? 'person');
    if (actor.kind === 'staff') await this.log(actor.userId, 'consent.unsubscribed_all', contactId, meta.reason);
  }

  /**
   * "Undo" on the unsubscribe confirmation page (13.6): lifts the unsubscribe and restores each topic to its
   * state before it. Only the person can do this, through their signed link.
   */
  async undoUnsubscribe(contactId: string): Promise<void> {
    const contact = await this.requireContact(contactId);
    if (!contact.email) return;
    const history = await this.deps.consent.history(contactId);
    // History is newest first (ordered by the database's microsecond timestamps): skip the unsubscribe batch.
    const isUnsubscribe = (row: ConsentRecord) => row.state === 'withdrawn' && row.reason === UNSUBSCRIBE_REASON;
    let start = history.findIndex(isUnsubscribe);
    if (!(await this.deps.consent.liftUnsubscribe(hashEmail(contact.email), 'undo'))) return;
    if (start >= 0) {
      while (start < history.length && isUnsubscribe(history[start] as ConsentRecord)) start += 1;
      const before = history.slice(start);
      const restore = TOPICS.flatMap((topic) => {
        const previous = before.find((row) => row.topic === topic);
        return previous && previous.state !== 'withdrawn' ? [{ topic, previous }] : [];
      });
      await this.deps.consent.insert(
        restore.map(({ topic, previous }) => ({
          contactId,
          topic,
          state: previous.state,
          method: 'link' as const,
          wordingVersion: previous.wordingVersion,
          sourceUrl: null,
          ip: null,
          actorId: null,
          reason: 'Unsubscribe undone',
        })),
      );
    }
    await this.syncStatus(contact, 'person');
  }

  /**
   * Adds an address to the suppression list from outside the contact record: hard bounces (EML-05),
   * complaints (EML-06), erasure (AUD-18). The contact's status follows; a complaint also withdraws consent.
   */
  async suppress(email: string, reason: SuppressionReason, source: string): Promise<Contact | null> {
    const hash = hashEmail(email);
    const active = await this.deps.consent.active(hash);
    if (!active.some((row) => row.reason === reason)) await this.deps.consent.suppress(hash, reason, source);
    const contact = await this.deps.contacts.findByEmail(email.trim().toLowerCase());
    if (!contact) return null;
    if (reason === 'complaint') {
      await this.unsubscribeAll(contact.id, 'complaint', { kind: 'system', name: source }, { reason: 'Spam complaint' });
    }
    return this.syncStatus(contact, source);
  }

  async summary() {
    return this.deps.consent.summary();
  }

  private validate(change: ConsentChange, actor: ConsentActor) {
    if (change.topics.length === 0) throw new ConsentRuleError('topics', 'Choose at least one topic');
    if (change.method === 'manual') {
      if (actor.kind !== 'staff') throw new ConsentRuleError('method', 'Only staff record manual changes');
      // 6.3 rule 5: staff change consent manually only with a reason.
      if (!change.reason?.trim()) throw new ConsentRuleError('reason', 'Give a reason for the manual change');
    }
    if (change.wordingVersion) {
      const wording = findWording(change.wordingVersion);
      if (!wording) throw new ConsentRuleError('wordingVersion', `Unknown consent wording ${change.wordingVersion}`);
      if (change.topics.some((topic) => topic !== wording.topic)) {
        throw new ConsentRuleError('wordingVersion', `Wording ${wording.version} is for the ${wording.topic} topic`);
      }
    }
  }

  private async requireContact(contactId: string): Promise<Contact> {
    const contact = await this.deps.contacts.findById(contactId);
    if (!contact) throw new ConsentRuleError('contactId', 'Contact not found');
    if (contact.status === 'erased') throw new ConsentRuleError('contactId', 'This contact was erased');
    return contact;
  }

  /** Keeps Contact.status in line with the suppression list (AUD-12). */
  private async syncStatus(contact: Contact, actor: string): Promise<Contact> {
    if (!contact.email) return contact;
    const status = statusFromSuppressions(await this.deps.consent.active(hashEmail(contact.email)));
    if (status === contact.status) return contact;
    return (await this.deps.contacts.update(contact.id, { status }, actor)) ?? contact;
  }

  private async log(actor: string, action: string, contactId: string, reason?: string, metadata: Record<string, unknown> = {}) {
    // Permission-sensitive change (PRD 4.3); it is already stored, so an outage must not fail it.
    const entry = { actorId: actor, action, subjectType: 'contact', subjectId: contactId, reason, occurredAt: this.now().toISOString(), metadata };
    try {
      await this.deps.coreEngine.writeActivityLog(entry);
    } catch (error) {
      this.deps.logger.error({ err: error, activity: entry }, 'activity log write failed');
    }
  }
}
