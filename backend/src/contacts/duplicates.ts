import { and, count, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, duplicateDismissals } from '../db/schema.js';
import type { Contact } from './repository.js';

export type DuplicateReason = 'email_key' | 'phone' | 'name';

export type DuplicatePair = { contactIds: [string, string]; reason: DuplicateReason };

/** Lower-case, accents removed, single spaces: "Ánna  PETROSYAN" → "anna petrosyan". */
export function normalizePersonName(first: string | null, last: string | null): string {
  return [first, last]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit distance, stopping early once it exceeds `max`. */
export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

const localPart = (email: string | null) => (email ?? '').split('@')[0]?.replace(/[^a-z0-9]/g, '') ?? '';

/**
 * Name match (the third rule of AUD-04): names equal or one typo apart, and the email local parts close
 * too. Name alone is not enough: common Armenian names would flood the review list with strangers.
 */
export function namesLookAlike(a: Pick<Contact, 'firstName' | 'lastName' | 'email'>, b: Pick<Contact, 'firstName' | 'lastName' | 'email'>): boolean {
  const nameA = normalizePersonName(a.firstName, a.lastName);
  const nameB = normalizePersonName(b.firstName, b.lastName);
  if (nameA.length < 5 || nameB.length < 5 || !nameA.includes(' ') || !nameB.includes(' ')) return false;
  if (levenshtein(nameA, nameB, 1) > 1) return false;
  const [la, lb] = [localPart(a.email), localPart(b.email)];
  return la.length > 0 && lb.length > 0 && (la.includes(lb) || lb.includes(la) || levenshtein(la, lb, 2) <= 2);
}

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Duplicate detection (AUD-04): by normalized email (plus tags, Gmail dots), then phone, then name with a
 * fuzzy match. Results are suggestions for review; merging is AUD-05.
 */
export class DuplicateService {
  constructor(private readonly db: AppPgDatabase) {}

  /** Suggested pairs across the whole base, strongest reason first. */
  async suggestions(limit = 100): Promise<DuplicatePair[]> {
    const dismissed = await this.dismissed();
    const pairs = new Map<string, DuplicatePair>();
    const add = (ids: string[], reason: DuplicateReason) => {
      const [first, ...rest] = [...ids].sort();
      for (const other of rest) {
        const key = pairKey(first as string, other);
        if (!dismissed.has(key) && !pairs.has(key)) pairs.set(key, { contactIds: [first as string, other], reason });
      }
    };

    for (const column of [contacts.emailKey, contacts.phone] as const) {
      const groups = await this.db
        .select({ ids: sql<string[]>`array_agg(${contacts.id})` })
        .from(contacts)
        .where(and(isNotNull(column), ne(contacts.status, 'erased')))
        .groupBy(column)
        .having(sql`${count()} > 1`)
        .limit(limit);
      for (const group of groups) add(group.ids, column === contacts.emailKey ? 'email_key' : 'phone');
    }

    if (pairs.size < limit) {
      // Bucket by the first three letters of the normalized name to keep comparisons small at 50,000 contacts.
      const people = await this.db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
        .from(contacts)
        .where(and(isNotNull(contacts.lastName), ne(contacts.status, 'erased')));
      const buckets = new Map<string, typeof people>();
      for (const person of people) {
        const key = normalizePersonName(person.firstName, person.lastName).slice(0, 3);
        buckets.set(key, [...(buckets.get(key) ?? []), person]);
      }
      for (const bucket of buckets.values()) {
        for (let i = 0; i < bucket.length && pairs.size < limit; i += 1) {
          for (let j = i + 1; j < bucket.length; j += 1) {
            if (namesLookAlike(bucket[i]!, bucket[j]!)) add([bucket[i]!.id, bucket[j]!.id], 'name');
          }
        }
      }
    }
    return [...pairs.values()].slice(0, limit);
  }

  /** Possible duplicates of one contact (AUD-04 "on create"; shown on the contact record). */
  async forContact(contact: Contact): Promise<{ contactId: string; reason: DuplicateReason }[]> {
    const conditions = [
      contact.emailKey ? eq(contacts.emailKey, contact.emailKey) : undefined,
      contact.phone ? eq(contacts.phone, contact.phone) : undefined,
      contact.lastName ? eq(sql`lower(${contacts.lastName})`, contact.lastName.toLowerCase()) : undefined,
    ].filter((condition) => condition !== undefined);
    if (conditions.length === 0 || contact.status === 'erased') return [];
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(ne(contacts.id, contact.id), ne(contacts.status, 'erased'), or(...conditions)))
      .limit(50);
    const dismissed = await this.dismissed([contact.id]);
    const result: { contactId: string; reason: DuplicateReason }[] = [];
    for (const row of rows as Contact[]) {
      if (dismissed.has(pairKey(contact.id, row.id))) continue;
      const reason: DuplicateReason | null =
        contact.emailKey && row.emailKey === contact.emailKey
          ? 'email_key'
          : contact.phone && row.phone === contact.phone
            ? 'phone'
            : namesLookAlike(contact, row)
              ? 'name'
              : null;
      if (reason) result.push({ contactId: row.id, reason });
    }
    return result;
  }

  /** "Not the same person": the pair is never suggested again. */
  async dismiss(a: string, b: string, actorId: string): Promise<void> {
    const [contactA, contactB] = a < b ? [a, b] : [b, a];
    await this.db.insert(duplicateDismissals).values({ contactA, contactB, actorId }).onConflictDoNothing();
  }

  private async dismissed(forIds?: string[]): Promise<Set<string>> {
    const rows = await this.db
      .select()
      .from(duplicateDismissals)
      .where(forIds ? or(inArray(duplicateDismissals.contactA, forIds), inArray(duplicateDismissals.contactB, forIds)) : undefined);
    return new Set(rows.map((row) => pairKey(row.contactA, row.contactB)));
  }
}
