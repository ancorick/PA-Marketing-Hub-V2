import { and, arrayContains, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { auditEvents, contacts, type ContactRow } from '../db/schema.js';
import type { AppPgDatabase } from '../db/client.js';
import { emailKey, type ContactStatus, type ContactType, type Frequency } from './fields.js';
import type { Language } from '../integrations/core-engine/contract.js';

export type Contact = Omit<ContactRow, 'language' | 'type' | 'status' | 'frequency'> & {
  language: Language;
  type: ContactType;
  status: ContactStatus;
  frequency: Frequency;
};

/** Fields set on create; status starts as active. */
export type NewContact = Pick<
  Contact,
  | 'corePersonId'
  | 'email'
  | 'phone'
  | 'firstName'
  | 'lastName'
  | 'language'
  | 'type'
  | 'sourceChannel'
  | 'sourceCampaign'
  | 'firstTouchAt'
  | 'tags'
>;

/** Status changes come from suppression (AUD-12) and erasure (AUD-18), never from the edit form. */
export type ContactChanges = Partial<NewContact> & { status?: ContactStatus; frequency?: Frequency };

export type ContactFilter = {
  /** Part of the email or of "first last", case-insensitive. */
  search?: string;
  type?: ContactType;
  language?: Language;
  tag?: string;
  limit: number;
  offset: number;
};

export type ContactPage = { contacts: Contact[]; total: number };

export type AuditEntry = { action: string; actorId: string; fields: string[]; at: Date };

/** The unique email or Core Engine person ID already belongs to another contact (AUD-01). */
export class DuplicateContactError extends Error {
  constructor(
    readonly field: 'email' | 'corePersonId',
    readonly existingId: string | null,
  ) {
    super(field === 'email' ? 'A contact with this email already exists' : 'This Core Engine person is already linked to a contact');
    this.name = 'DuplicateContactError';
  }
}

export interface ContactRepository {
  list(filter: ContactFilter): Promise<ContactPage>;
  findById(id: string): Promise<Contact | null>;
  findByEmail(email: string): Promise<Contact | null>;
  findByCorePersonId(corePersonId: string): Promise<Contact | null>;
  /** Writes the contact and its audit row together. Throws DuplicateContactError on a unique clash. */
  insert(input: NewContact & { status?: ContactStatus; importId?: string | null }, actorId: string): Promise<Contact>;
  /** Applies the changes and writes one audit row naming the changed fields. Null when the contact is gone. */
  update(id: string, changes: ContactChanges, actorId: string): Promise<Contact | null>;
  /** Contacts with any of these (normalized) emails. */
  findByEmails(emails: string[]): Promise<Contact[]>;
  /** Bulk create for imports: one transaction per call, one audit row per contact. */
  insertMany(inputs: (NewContact & { status?: ContactStatus; importId?: string | null })[], actorId: string): Promise<Contact[]>;
  /** Audit rows for one contact, oldest first (PRD 12.4; feeds the AUD-16 timeline later). */
  auditTrail(contactId: string): Promise<AuditEntry[]>;
}

/** Text columns hold only the values the service writes. */
const toContact = (row: ContactRow): Contact => row as Contact;

const uniqueViolation = (error: unknown): string | null => {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const pg = candidate as { code?: string; constraint?: string } | null;
    if (pg?.code === '23505') return pg.constraint ?? '';
  }
  return null;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export class DrizzleContactRepository implements ContactRepository {
  constructor(private readonly db: AppPgDatabase) {}

  async list(filter: ContactFilter): Promise<ContactPage> {
    const conditions: SQL[] = [];
    const search = filter.search?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(
        or(ilike(contacts.email, pattern), ilike(sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})`, pattern)) as SQL,
      );
    }
    if (filter.type) conditions.push(eq(contacts.type, filter.type));
    if (filter.language) conditions.push(eq(contacts.language, filter.language));
    if (filter.tag) conditions.push(arrayContains(contacts.tags, [filter.tag]));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(contacts)
        .where(where)
        .orderBy(desc(contacts.createdAt), asc(contacts.id))
        .limit(filter.limit)
        .offset(filter.offset),
      this.db.select({ value: count() }).from(contacts).where(where),
    ]);
    return { contacts: rows.map(toContact), total: total?.value ?? 0 };
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(contacts).where(eq(contacts.id, id));
    return row ? toContact(row) : null;
  }

  async findByEmail(email: string) {
    const [row] = await this.db.select().from(contacts).where(eq(contacts.email, email));
    return row ? toContact(row) : null;
  }

  async findByCorePersonId(corePersonId: string) {
    const [row] = await this.db.select().from(contacts).where(eq(contacts.corePersonId, corePersonId));
    return row ? toContact(row) : null;
  }

  async insert(input: NewContact & { status?: ContactStatus; importId?: string | null }, actorId: string) {
    return this.withDuplicates(input, () =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(contacts)
          .values({ ...input, emailKey: input.email ? emailKey(input.email) : null })
          .returning();
        const created = toContact(row as ContactRow);
        await tx.insert(auditEvents).values({
          entityType: 'contact',
          entityId: created.id,
          action: 'contact.created',
          actorId,
          fields: Object.keys(input).filter((key) => key !== 'importId' && input[key as keyof typeof input] != null),
        });
        return created;
      }),
    );
  }

  async update(id: string, changes: ContactChanges, actorId: string) {
    return this.withDuplicates(changes, () =>
      this.db.transaction(async (tx) => {
        const values = changes.email !== undefined ? { ...changes, emailKey: changes.email ? emailKey(changes.email) : null } : changes;
        const [row] = await tx.update(contacts).set(values).where(eq(contacts.id, id)).returning();
        if (!row) return null;
        await tx.insert(auditEvents).values({
          entityType: 'contact',
          entityId: id,
          action: 'contact.updated',
          actorId,
          fields: Object.keys(changes),
        });
        return toContact(row);
      }),
    );
  }

  async findByEmails(emails: string[]) {
    if (emails.length === 0) return [];
    return (await this.db.select().from(contacts).where(inArray(contacts.email, emails))).map(toContact);
  }

  async insertMany(inputs: (NewContact & { status?: ContactStatus; importId?: string | null })[], actorId: string) {
    if (inputs.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(contacts)
        .values(inputs.map((input) => ({ ...input, emailKey: input.email ? emailKey(input.email) : null })))
        .returning();
      await tx.insert(auditEvents).values(
        rows.map((row) => ({
          entityType: 'contact',
          entityId: row.id,
          action: 'contact.imported',
          actorId,
          fields: ['email', 'firstName', 'lastName', 'phone', 'language', 'type', 'sourceChannel', 'sourceCampaign', 'firstTouchAt', 'tags'].filter(
            (key) => row[key as keyof ContactRow] != null,
          ),
        })),
      );
      return rows.map(toContact);
    });
  }

  async auditTrail(contactId: string) {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'contact'), eq(auditEvents.entityId, contactId)))
      .orderBy(asc(auditEvents.createdAt));
    return rows.map((row) => ({ action: row.action, actorId: row.actorId, fields: row.fields, at: row.createdAt }));
  }

  /** A concurrent create can still hit the unique constraints after the service's own check. */
  private async withDuplicates<T>(values: ContactChanges, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === null) throw error;
      if (constraint.includes('core_person_id')) {
        const existing = values.corePersonId ? await this.findByCorePersonId(values.corePersonId) : null;
        throw new DuplicateContactError('corePersonId', existing?.id ?? null);
      }
      const existing = values.email ? await this.findByEmail(values.email) : null;
      throw new DuplicateContactError('email', existing?.id ?? null);
    }
  }
}
