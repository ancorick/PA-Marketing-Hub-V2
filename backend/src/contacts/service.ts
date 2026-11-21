import type { CoreEngineClient, CorePerson, Language } from '../integrations/core-engine/contract.js';
import {
  ContactFieldError,
  normalizeCampaign,
  normalizeEmail,
  normalizeFirstTouch,
  normalizeName,
  normalizePhone,
  normalizeTags,
  typeFromLifecycle,
  type ChannelId,
  type ContactStatus,
  type Frequency,
  type ContactType,
} from './fields.js';
import {
  DuplicateContactError,
  type AuditEntry,
  type Contact,
  type ContactChanges,
  type ContactFilter,
  type ContactRepository,
  type NewContact,
} from './repository.js';

/** The Core Engine could not be asked about a person the request names explicitly. */
export class CoreEngineUnavailableError extends Error {
  constructor() {
    super('The Core Engine is not reachable; try again in a minute');
    this.name = 'CoreEngineUnavailableError';
  }
}

export type CreateContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  language: Language;
  /** Ignored when the contact is linked to a Core Engine person: the lifecycle decides the type. */
  type?: ContactType;
  sourceChannel: ChannelId;
  sourceCampaign?: string | null;
  /** Defaults to now. */
  firstTouchAt?: Date;
  tags?: string[];
  /** Link to a known Core Engine person; without it the person is looked up by email. */
  corePersonId?: string;
};

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'firstTouchAt'>> & { firstTouchAt?: Date };

export type ContactView = {
  id: string;
  corePersonId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  language: Language;
  type: ContactType;
  /** core_engine: the type mirrors the Core Engine lifecycle and cannot be edited here (PRD 6.1). */
  typeSource: 'core_engine' | 'marketing_hub';
  sourceChannel: string | null;
  sourceCampaign: string | null;
  firstTouchAt: string;
  tags: string[];
  status: ContactStatus;
  frequency: Frequency;
  /** EML-15: re-engagement email sent / moved out of regular sends. */
  reengagementSentAt: string | null;
  sunsetAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactDetailView = ContactView & {
  /** Who changed which fields and when (PRD 12.4); values are not kept. */
  history: { action: string; actorId: string; fields: string[]; at: string }[];
};

type Actor = { userId: string };

type ContactServiceDeps = {
  repository: ContactRepository;
  coreEngine: Pick<CoreEngineClient, 'getPerson' | 'findPersonByEmail'>;
  logger: { warn: (obj: object, msg: string) => void };
  /** AUD-12: a new record for a suppressed address starts with that status (no import can override it). */
  statusForEmail?: (email: string) => Promise<ContactStatus>;
  now?: () => Date;
};

const toView = (contact: Contact): ContactView => ({
  id: contact.id,
  corePersonId: contact.corePersonId,
  email: contact.email,
  phone: contact.phone,
  firstName: contact.firstName,
  lastName: contact.lastName,
  language: contact.language,
  type: contact.type,
  typeSource: contact.corePersonId ? 'core_engine' : 'marketing_hub',
  sourceChannel: contact.sourceChannel,
  sourceCampaign: contact.sourceCampaign,
  firstTouchAt: contact.firstTouchAt.toISOString(),
  tags: contact.tags,
  status: contact.status,
  frequency: contact.frequency,
  reengagementSentAt: contact.reengagementSentAt?.toISOString() ?? null,
  sunsetAt: contact.sunsetAt?.toISOString() ?? null,
  createdAt: contact.createdAt.toISOString(),
  updatedAt: contact.updatedAt.toISOString(),
});

const historyView = (entry: AuditEntry) => ({ ...entry, at: entry.at.toISOString() });

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);

/**
 * Audience contacts (AUD-01, AUD-02): one record per person, keyed by normalized email and, when the
 * person exists in the Core Engine, by its person ID. Duplicate detection beyond exact matches is AUD-04.
 */
export class ContactService {
  private readonly now: () => Date;

  constructor(private readonly deps: ContactServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(filter: ContactFilter): Promise<{ contacts: ContactView[]; total: number }> {
    const page = await this.deps.repository.list(filter);
    return { contacts: page.contacts.map(toView), total: page.total };
  }

  async get(id: string): Promise<ContactDetailView | null> {
    const contact = await this.deps.repository.findById(id);
    if (!contact) return null;
    const history = await this.deps.repository.auditTrail(id);
    return { ...toView(contact), history: history.map(historyView) };
  }

  async create(input: CreateContactInput, actor: Actor): Promise<ContactView> {
    const email = normalizeEmail(input.email);
    const person = input.corePersonId ? await this.personById(input.corePersonId) : await this.personByEmail(email);

    const fields: NewContact = {
      corePersonId: person?.id ?? null,
      email,
      // The Core Engine fills what the form left empty; what staff typed wins.
      firstName: normalizeName(input.firstName) ?? normalizeName(person?.firstName),
      lastName: normalizeName(input.lastName) ?? normalizeName(person?.lastName),
      phone: normalizePhone(input.phone) ?? normalizePhone(person?.phone),
      language: input.language,
      type: person ? typeFromLifecycle(person.lifecycleStatus) : (input.type ?? 'subscriber'),
      sourceChannel: input.sourceChannel,
      sourceCampaign: normalizeCampaign(input.sourceCampaign),
      firstTouchAt: normalizeFirstTouch(input.firstTouchAt ?? this.now(), this.now()),
      tags: normalizeTags(input.tags ?? []),
    };

    // Exact-match checks first, for a clear message with a link to the existing record.
    const byEmail = await this.deps.repository.findByEmail(email);
    if (byEmail) throw new DuplicateContactError('email', byEmail.id);
    if (fields.corePersonId) {
      const byPerson = await this.deps.repository.findByCorePersonId(fields.corePersonId);
      if (byPerson) throw new DuplicateContactError('corePersonId', byPerson.id);
    }
    const status = (await this.deps.statusForEmail?.(email)) ?? 'active';
    return toView(await this.deps.repository.insert({ ...fields, status }, actor.userId));
  }

  async update(id: string, input: UpdateContactInput, actor: Actor): Promise<ContactView | null> {
    const contact = await this.deps.repository.findById(id);
    if (!contact) return null;
    if (contact.status === 'erased') throw new ContactFieldError('status', 'This contact was erased and cannot be edited');

    const changes: ContactChanges = {};
    if (input.email !== undefined) changes.email = normalizeEmail(input.email);
    if (input.firstName !== undefined) changes.firstName = normalizeName(input.firstName);
    if (input.lastName !== undefined) changes.lastName = normalizeName(input.lastName);
    if (input.phone !== undefined) changes.phone = normalizePhone(input.phone);
    if (input.language !== undefined) changes.language = input.language;
    if (input.sourceChannel !== undefined) changes.sourceChannel = input.sourceChannel;
    if (input.sourceCampaign !== undefined) changes.sourceCampaign = normalizeCampaign(input.sourceCampaign);
    if (input.firstTouchAt !== undefined) changes.firstTouchAt = normalizeFirstTouch(input.firstTouchAt, this.now());
    if (input.tags !== undefined) changes.tags = normalizeTags(input.tags);

    if (input.corePersonId !== undefined && input.corePersonId !== contact.corePersonId) {
      if (contact.corePersonId) {
        throw new ContactFieldError('corePersonId', 'This contact is already linked to a Core Engine person; the link cannot be changed here');
      }
      const person = await this.personById(input.corePersonId);
      changes.corePersonId = person.id;
      changes.type = typeFromLifecycle(person.lifecycleStatus);
    }
    const linked = changes.corePersonId ?? contact.corePersonId;
    if (input.type !== undefined && input.type !== (changes.type ?? contact.type)) {
      if (linked) {
        throw new ContactFieldError('type', 'The type of a contact linked to the Core Engine follows its lifecycle status');
      }
      changes.type = input.type;
    }

    // Only real changes are written and audited.
    for (const key of Object.keys(changes) as (keyof ContactChanges)[]) {
      if (sameValue(changes[key], contact[key])) delete changes[key];
    }
    if (Object.keys(changes).length === 0) return toView(contact);

    if (changes.email) {
      const byEmail = await this.deps.repository.findByEmail(changes.email);
      if (byEmail && byEmail.id !== id) throw new DuplicateContactError('email', byEmail.id);
    }
    if (changes.corePersonId) {
      const byPerson = await this.deps.repository.findByCorePersonId(changes.corePersonId);
      if (byPerson && byPerson.id !== id) throw new DuplicateContactError('corePersonId', byPerson.id);
    }
    const updated = await this.deps.repository.update(id, changes, actor.userId);
    return updated ? toView(updated) : null;
  }

  /** Staff named the person: it must exist, and an outage is an error rather than a silent unlinked record. */
  private async personById(corePersonId: string): Promise<CorePerson> {
    let person: CorePerson | null;
    try {
      person = await this.deps.coreEngine.getPerson(corePersonId);
    } catch {
      throw new CoreEngineUnavailableError();
    }
    if (!person) throw new ContactFieldError('corePersonId', 'No person with this ID exists in the Core Engine');
    return person;
  }

  /**
   * AUD-01 "linked when one exists": look the email up in the Core Engine. During an outage the contact is
   * created unlinked; the two-way sync (AUD-06) links it later.
   */
  private async personByEmail(email: string): Promise<CorePerson | null> {
    try {
      return await this.deps.coreEngine.findPersonByEmail(email);
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Core Engine lookup failed; contact created without a person link');
      return null;
    }
  }
}
