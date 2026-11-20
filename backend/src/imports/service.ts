import { desc, eq, inArray, or } from 'drizzle-orm';
import type { ConsentRepository, NewConsentRecord } from '../consent/repository.js';
import { statusFromSuppressions, type ConsentService } from '../consent/service.js';
import type { Topic } from '../consent/wordings.js';
import {
  CHANNELS,
  CONTACT_TYPES,
  ContactFieldError,
  emailKey,
  hashEmail,
  LANGUAGES,
  normalizeCampaign,
  normalizeEmail,
  normalizeFirstTouch,
  normalizeName,
  normalizePhone,
  normalizeTags,
  type ChannelId,
  type ContactType,
} from '../contacts/fields.js';
import type { Contact, ContactRepository, NewContact } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { contactImports, contacts } from '../db/schema.js';
import type { Language } from '../integrations/core-engine/contract.js';
import { parseCsv } from './csv.js';

/** Contact fields a CSV column can fill (AUD-03). */
export const IMPORT_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'language',
  'type',
  'sourceChannel',
  'sourceCampaign',
  'firstTouchAt',
  'tags',
  'consent',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index → field; unmapped columns are ignored. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export type ImportOptions = {
  /** Used when the file has no language column or the cell is empty. */
  defaultLanguage: Language;
  /** Used when the file has no channel column; required then (every contact has one known source). */
  defaultSourceChannel?: ChannelId;
  sourceCampaign?: string | null;
  /** Added to every imported contact, e.g. "open-day-2025". */
  tags?: string[];
  /** Topic the consent column refers to. */
  consentTopic?: Topic;
};

export type RowStatus = 'new' | 'match' | 'duplicate_in_file' | 'invalid';

export type PreviewRow = {
  /** 1-based line number in the file, header = 1. */
  line: number;
  status: RowStatus;
  email: string | null;
  name: string | null;
  errors: string[];
  /** AUD-04: an existing contact or an earlier row that looks like the same person. */
  possibleDuplicate: { contactId: string | null; line: number | null; reason: 'email_key' | 'phone' } | null;
  consent: 'granted' | 'withdrawn' | 'unknown';
};

export type ImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  totals: { rows: number; new: number; match: number; duplicate_in_file: number; invalid: number; possibleDuplicates: number };
  /** False = no consent column: rows are imported as unknown consent and get no marketing email (6.3 rule 2). */
  hasConsentColumn: boolean;
  sample: PreviewRow[];
  problems: PreviewRow[];
};

export type ImportResult = { importId: string; created: number; updated: number; skipped: number; invalid: number };

type Candidate = {
  line: number;
  email: string;
  fields: NewContact;
  consent: 'granted' | 'withdrawn' | 'unknown';
};

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  email: ['email', 'e-mail', 'email address', 'mail', 'почта', 'электронная почта', 'էլ. փոստ', 'էլփոստ', 'էլ.փոստ'],
  firstName: ['first name', 'firstname', 'given name', 'name first', 'имя', 'անուն'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'фамилия', 'ազգանուն'],
  fullName: ['name', 'full name', 'fullname', 'фио', 'անուն ազգանուն'],
  phone: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'телефон', 'հեռախոս', 'հեռախոսահամար'],
  language: ['language', 'lang', 'preferred language', 'язык', 'լեզու'],
  type: ['type', 'contact type', 'тип'],
  sourceChannel: ['source', 'channel', 'source channel', 'источник', 'канал', 'աղբյուր'],
  sourceCampaign: ['campaign', 'source campaign', 'utm_campaign', 'кампания'],
  firstTouchAt: ['first touch', 'date', 'signed up', 'registered', 'created', 'дата', 'ամսաթիվ'],
  tags: ['tags', 'tag', 'labels', 'теги', 'պիտակներ'],
  consent: ['consent', 'subscribed', 'opt in', 'opt-in', 'newsletter', 'согласие', 'համաձայնություն'],
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');

/** Suggests a mapping from header names; staff confirm or change it in the preview (AUD-03). */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((header, index) => {
    const name = normalizeHeader(header);
    const field = IMPORT_FIELDS.find((candidate) => mapping[candidate] === undefined && HEADER_SYNONYMS[candidate].includes(name));
    if (field) mapping[field] = index;
  });
  return mapping;
}

const LANGUAGE_VALUES: Record<string, Language> = {
  hy: 'hy', am: 'hy', arm: 'hy', armenian: 'hy', 'հայերեն': 'hy', 'армянский': 'hy',
  en: 'en', eng: 'en', english: 'en', 'անգլերեն': 'en', 'английский': 'en',
  ru: 'ru', rus: 'ru', russian: 'ru', 'ռուսերեն': 'ru', 'русский': 'ru',
};
const CONSENT_YES = new Set(['yes', 'y', 'true', '1', 'granted', 'subscribed', 'opt-in', 'да', 'այո']);
const CONSENT_NO = new Set(['no', 'n', 'false', '0', 'withdrawn', 'unsubscribed', 'opt-out', 'нет', 'ոչ']);

function parseDate(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const european = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : european ? [european[3], european[2], european[1]] : [];
  if (!y || !m || !d) return null;
  // A date in the file is a calendar day in Yerevan.
  const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+04:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type ImportServiceDeps = {
  db: AppPgDatabase;
  contacts: Pick<ContactRepository, 'findByEmails' | 'insertMany' | 'update'>;
  consentRepository: Pick<ConsentRepository, 'activeByHashes' | 'insert'>;
  consent: Pick<ConsentService, 'record'>;
  now?: () => Date;
};

const CHUNK = 500;

/**
 * CSV import (AUD-03) with duplicate detection (AUD-04, NFR-F7): parse, map columns, validate every row,
 * preview new / matching / duplicate / invalid rows before anything is written, then commit in batches.
 * Exact email matches update the existing record (tags, empty fields, consent under 6.3); they never
 * change its source or first touch.
 */
export class ImportService {
  private readonly now: () => Date;

  constructor(private readonly deps: ImportServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async preview(csv: string, mapping: ColumnMapping | undefined, options: ImportOptions): Promise<ImportPreview> {
    const parsed = await this.analyse(csv, mapping, options);
    const counts = { rows: parsed.rows.length, new: 0, match: 0, duplicate_in_file: 0, invalid: 0, possibleDuplicates: 0 };
    for (const row of parsed.rows) {
      counts[row.status] += 1;
      if (row.possibleDuplicate) counts.possibleDuplicates += 1;
    }
    return {
      headers: parsed.headers,
      mapping: parsed.mapping,
      totals: counts,
      hasConsentColumn: parsed.mapping.consent !== undefined,
      sample: parsed.rows.slice(0, 50),
      problems: parsed.rows.filter((row) => row.status === 'invalid' || row.possibleDuplicate).slice(0, 200),
    };
  }

  async commit(fileName: string, csv: string, mapping: ColumnMapping | undefined, options: ImportOptions, actorId: string): Promise<ImportResult> {
    const parsed = await this.analyse(csv, mapping, options);
    const [record] = await this.deps.db
      .insert(contactImports)
      .values({
        fileName,
        actorId,
        rowsTotal: parsed.rows.length,
        created: 0,
        updated: 0,
        invalid: 0,
        settings: { mapping: parsed.mapping, options } as Record<string, unknown>,
      })
      .returning();
    const importId = (record as { id: string }).id;
    const actor = `import:${actorId}`;
    let created = 0;
    let updated = 0;

    const newRows = parsed.candidates.filter((candidate) => parsed.status.get(candidate.line) === 'new');
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const chunk = newRows.slice(i, i + CHUNK);
      // AUD-12: a suppressed address keeps its status in the new record; no import overrides it.
      const suppressed = await this.deps.consentRepository.activeByHashes(chunk.map((row) => hashEmail(row.email)));
      const inserted = await this.deps.contacts.insertMany(
        chunk.map((row) => ({
          ...row.fields,
          importId,
          status: statusFromSuppressions((suppressed.get(hashEmail(row.email)) ?? []).map((reason) => ({ reason }))),
        })),
        actor,
      );
      created += inserted.length;
      const byEmail = new Map(inserted.map((contact) => [contact.email, contact]));
      const records: NewConsentRecord[] = chunk.flatMap((row) => {
        const contact = byEmail.get(row.email);
        if (!contact || row.consent === 'unknown' || !options.consentTopic) return [];
        if (row.consent === 'granted' && contact.status !== 'active') return [];
        return [
          {
            contactId: contact.id,
            topic: options.consentTopic,
            state: row.consent,
            method: 'import' as const,
            wordingVersion: null,
            sourceUrl: `import ${fileName}`,
            ip: null,
            actorId: actor,
            reason: null,
          },
        ];
      });
      await this.deps.consentRepository.insert(records);
    }

    const matches = parsed.candidates.filter((candidate) => parsed.status.get(candidate.line) === 'match');
    for (const row of matches) {
      const existing = parsed.existing.get(row.email) as Contact;
      const tags = [...new Set([...existing.tags, ...row.fields.tags])];
      const changes = {
        ...(!existing.firstName && row.fields.firstName && { firstName: row.fields.firstName }),
        ...(!existing.lastName && row.fields.lastName && { lastName: row.fields.lastName }),
        ...(!existing.phone && row.fields.phone && { phone: row.fields.phone }),
        ...(tags.length !== existing.tags.length && { tags: tags.slice(0, 20) }),
      };
      if (Object.keys(changes).length > 0) await this.deps.contacts.update(existing.id, changes, actor);
      if (row.consent !== 'unknown' && options.consentTopic && existing.status !== 'erased') {
        // Through the consent rules: an import never turns a withdrawal or a suppression into consent.
        await this.deps.consent.record(
          existing.id,
          { topics: [options.consentTopic], state: row.consent, method: 'import', sourceUrl: `import ${fileName}` },
          { kind: 'system', name: actor },
        );
      }
      updated += 1;
    }

    const invalid = parsed.rows.filter((row) => row.status === 'invalid').length;
    const skipped = parsed.rows.filter((row) => row.status === 'duplicate_in_file').length;
    await this.deps.db
      .update(contactImports)
      .set({ created, updated, invalid })
      .where(eq(contactImports.id, importId));
    return { importId, created, updated, skipped, invalid };
  }

  async list() {
    return this.deps.db.select().from(contactImports).orderBy(desc(contactImports.createdAt)).limit(50);
  }

  private async analyse(csv: string, requested: ColumnMapping | undefined, options: ImportOptions) {
    let parsed: string[][];
    try {
      parsed = parseCsv(csv).rows;
    } catch (error) {
      throw new ContactFieldError('csv', (error as Error).message);
    }
    if (parsed.length < 2) throw new ContactFieldError('csv', 'The file needs a header row and at least one contact');
    const [headerRow, ...dataRows] = parsed as [string[], ...string[][]];
    const headers = headerRow.map((header) => header.trim());
    const mapping = requested ?? suggestMapping(headers);
    if (mapping.email === undefined) throw new ContactFieldError('mapping', 'Choose the column that holds email addresses');
    if (mapping.sourceChannel === undefined && !options.defaultSourceChannel) {
      throw new ContactFieldError('defaultSourceChannel', 'Choose where these contacts came from, or map a source column');
    }
    for (const [field, index] of Object.entries(mapping)) {
      if (index !== undefined && (index < 0 || index >= headers.length)) throw new ContactFieldError('mapping', `Column for ${field} does not exist`);
    }
    if (mapping.consent !== undefined && !options.consentTopic) {
      throw new ContactFieldError('consentTopic', 'Choose which topic the consent column refers to');
    }
    const campaign = normalizeCampaign(options.sourceCampaign);
    const extraTags = normalizeTags(options.tags ?? []);
    const now = this.now();

    const rows: PreviewRow[] = [];
    const candidates: Candidate[] = [];
    const status = new Map<number, RowStatus>();
    const seenEmails = new Map<string, number>();
    const seenKeys = new Map<string, number>();
    const seenPhones = new Map<string, number>();

    dataRows.forEach((cells, index) => {
      const line = index + 2;
      const cell = (field: ImportField) => (mapping[field] === undefined ? '' : (cells[mapping[field] as number] ?? '').trim());
      const errors: string[] = [];
      const attempt = <T>(run: () => T): T | null => {
        try {
          return run();
        } catch (error) {
          errors.push((error as Error).message);
          return null;
        }
      };

      const email = attempt(() => normalizeEmail(cell('email')));
      let firstName = attempt(() => normalizeName(cell('firstName')));
      let lastName = attempt(() => normalizeName(cell('lastName')));
      if (!firstName && !lastName && cell('fullName')) {
        const parts = cell('fullName').split(/\s+/);
        firstName = parts.shift() ?? null;
        lastName = parts.join(' ') || null;
      }
      const phone = attempt(() => normalizePhone(cell('phone')));
      const languageCell = cell('language').toLowerCase();
      const language = languageCell ? LANGUAGE_VALUES[languageCell] : options.defaultLanguage;
      if (!language) errors.push(`Unknown language "${cell('language')}": use hy, en or ru`);
      const typeCell = cell('type').toLowerCase();
      const type = (typeCell ? CONTACT_TYPES.find((candidate) => candidate === typeCell || `${candidate}s` === typeCell) : 'subscriber') as ContactType | undefined;
      if (!type) errors.push(`Unknown type "${cell('type')}"`);
      const channelCell = cell('sourceChannel').toLowerCase();
      const channel = channelCell
        ? CHANNELS.find((candidate) => candidate.id === channelCell || candidate.name.toLowerCase() === channelCell)?.id
        : options.defaultSourceChannel;
      if (!channel) errors.push(`Unknown source "${cell('sourceChannel')}": use a channel from the taxonomy`);
      const rowCampaign = cell('sourceCampaign') ? attempt(() => normalizeCampaign(cell('sourceCampaign'))) : campaign;
      const dateCell = cell('firstTouchAt');
      const parsedDate = dateCell ? parseDate(dateCell) : now;
      if (!parsedDate) errors.push(`Unreadable date "${dateCell}": use 2026-03-01 or 01.03.2026`);
      const firstTouch = parsedDate ? attempt(() => normalizeFirstTouch(parsedDate, now)) : null;
      const tags = attempt(() => normalizeTags([...cell('tags').split(/[,;|]/), ...extraTags]));
      const consentCell = cell('consent').toLowerCase();
      const consent = CONSENT_YES.has(consentCell) ? 'granted' : CONSENT_NO.has(consentCell) ? 'withdrawn' : 'unknown';

      let rowStatus: RowStatus = errors.length > 0 ? 'invalid' : 'new';
      let possibleDuplicate: PreviewRow['possibleDuplicate'] = null;
      if (rowStatus !== 'invalid' && email) {
        if (seenEmails.has(email)) rowStatus = 'duplicate_in_file';
        else {
          seenEmails.set(email, line);
          const key = emailKey(email);
          const earlier = seenKeys.get(key) ?? (phone ? seenPhones.get(phone) : undefined);
          if (earlier !== undefined) possibleDuplicate = { contactId: null, line: earlier, reason: seenKeys.has(key) ? 'email_key' : 'phone' };
          seenKeys.set(key, line);
          if (phone) seenPhones.set(phone, line);
          candidates.push({
            line,
            email,
            consent,
            fields: {
              corePersonId: null,
              email,
              firstName,
              lastName,
              phone,
              language: language as Language,
              type: type as ContactType,
              sourceChannel: channel as ChannelId,
              sourceCampaign: rowCampaign,
              firstTouchAt: firstTouch as Date,
              tags: tags ?? [],
            },
          });
        }
      }
      status.set(line, rowStatus);
      rows.push({ line, status: rowStatus, email, name: [firstName, lastName].filter(Boolean).join(' ') || null, errors, possibleDuplicate, consent });
    });

    // Existing contacts: exact email = match; same duplicate key or phone = suggested merge (AUD-04).
    const existing = new Map<string, Contact>();
    for (let i = 0; i < candidates.length; i += 1000) {
      const found = await this.deps.contacts.findByEmails(candidates.slice(i, i + 1000).map((candidate) => candidate.email));
      for (const contact of found) if (contact.email) existing.set(contact.email, contact);
    }
    const similar = await this.findSimilar(candidates);
    for (const row of rows) {
      if (row.status !== 'new' || !row.email) continue;
      if (existing.has(row.email)) {
        row.status = 'match';
        status.set(row.line, 'match');
      } else if (!row.possibleDuplicate && similar.has(row.email)) {
        row.possibleDuplicate = similar.get(row.email) ?? null;
      }
    }
    return { headers, mapping, rows, candidates, status, existing };
  }

  /** Existing contacts with the same duplicate key or phone as a candidate row. */
  private async findSimilar(candidates: Candidate[]): Promise<Map<string, NonNullable<PreviewRow['possibleDuplicate']>>> {
    const result = new Map<string, NonNullable<PreviewRow['possibleDuplicate']>>();
    for (let i = 0; i < candidates.length; i += 1000) {
      const chunk = candidates.slice(i, i + 1000);
      const keys = chunk.map((candidate) => emailKey(candidate.email));
      const phones = chunk.map((candidate) => candidate.fields.phone).filter((phone): phone is string => phone !== null);
      const rows = await this.deps.db
        .select({ id: contacts.id, email: contacts.email, emailKey: contacts.emailKey, phone: contacts.phone })
        .from(contacts)
        .where(phones.length > 0 ? or(inArray(contacts.emailKey, keys), inArray(contacts.phone, phones)) : inArray(contacts.emailKey, keys));
      for (const candidate of chunk) {
        const key = emailKey(candidate.email);
        const hit =
          rows.find((row) => row.emailKey === key && row.email !== candidate.email) ??
          rows.find((row) => candidate.fields.phone && row.phone === candidate.fields.phone && row.email !== candidate.email);
        if (hit) result.set(candidate.email, { contactId: hit.id, line: null, reason: hit.emailKey === key ? 'email_key' : 'phone' });
      }
    }
    return result;
  }
}
