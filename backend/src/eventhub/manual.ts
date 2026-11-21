import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ConsentService } from '../consent/service.js';
import { findWording, TOPICS, type Topic } from '../consent/wordings.js';
import { ContactFieldError, normalizeEmail } from '../contacts/fields.js';
import type { AppPgDatabase } from '../db/client.js';
import { eventRegistrations, events } from '../db/schema.js';
import { parseCsv } from '../imports/csv.js';
import type { TouchpointRepository } from '../touchpoints/repository.js';
import { EVENT_TYPES } from './contract.js';
import { eventCampaignKey, type EventHubService } from './service.js';

const https = z.url({ protocol: /^https$/ }).max(2000);
export const manualEventSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(300),
  type: z.enum(EVENT_TYPES),
  startsAt: z.iso.datetime({ offset: true, message: 'Enter the date and time' }),
  language: z.enum(['hy', 'en', 'ru']).nullish(),
  public: z.boolean().default(false),
  registrationUrl: https.nullish(),
  registrationOpen: z.boolean().default(false),
  recordingUrl: https.nullish(),
  photosUrl: https.nullish(),
  mediaPublic: z.boolean().default(false),
});
export type ManualEventInput = z.infer<typeof manualEventSchema>;

export class ManualEventError extends Error {
  constructor(
    readonly code: 'not_found' | 'event_hub_owned' | 'invalid_rows',
    message: string,
    readonly rows: { line: number; message: string }[] = [],
  ) {
    super(message);
  }
}

type Row = { line: number; email: string; firstName: string | null; lastName: string | null; phone: string | null; language: 'hy' | 'en' | 'ru' | null; registeredAt: Date | null; attended: boolean | null; consent: { topic: Topic; wordingVersion: string }[] };

const YES = /^(yes|y|true|1|да|այո)$/i;
const NO = /^(no|n|false|0|нет|ոչ)?$/i;

/**
 * Fallback while Event Hub is not connected (PRD 10.5): events entered by hand and attendee lists imported from
 * CSV with consent columns. They feed the same tables, touchpoints and Events view as Event Hub, so the
 * contract stays unchanged for later.
 */
export class ManualEvents {
  constructor(
    private readonly deps: {
      db: AppPgDatabase;
      eventHub: Pick<EventHubService, 'matchOrCreate'>;
      consent: Pick<ConsentService, 'record'>;
      touchpoints: Pick<TouchpointRepository, 'recordOnce'>;
    },
  ) {}

  async create(input: ManualEventInput) {
    const [row] = await this.deps.db.insert(events).values(this.values(input)).returning();
    return row!;
  }

  async update(id: string, input: ManualEventInput) {
    const event = await this.manual(id);
    const [row] = await this.deps.db.update(events).set(this.values(input)).where(eq(events.id, event.id)).returning();
    return row!;
  }

  /**
   * Attendee CSV. Columns: email (required); optional first_name, last_name, phone, language, registered_at
   * (ISO date or date-time), attended (yes/no; default from the form), and consent_newsletter,
   * consent_courses, consent_events, consent_alumni holding the wording version the person agreed to (empty =
   * no consent). Nothing is saved unless every row is valid.
   */
  async importAttendees(id: string, csv: string, options: { attendedByDefault: boolean }, actor: string) {
    const event = await this.manual(id);
    const rows = this.parse(csv, options.attendedByDefault);
    const campaign = eventCampaignKey(event);
    let created = 0;
    let consents = 0;
    for (const row of rows) {
      const registeredAt = row.registeredAt ?? event.startsAt;
      const contact = await this.deps.eventHub.matchOrCreate(row, { campaign, registeredAt, language: row.language ?? ((event.language as 'hy' | 'en' | 'ru' | null) ?? 'hy') });
      const checkedInAt = row.attended ? event.startsAt : null;
      const [registration] = await this.deps.db
        .insert(eventRegistrations)
        .values({ eventId: event.id, contactId: contact.id, registeredAt, checkedInAt, source: 'csv' })
        .onConflictDoUpdate({ target: [eventRegistrations.eventId, eventRegistrations.contactId], set: { registeredAt, ...(checkedInAt && { checkedInAt }), status: 'registered', cancelledAt: null } })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (registration?.inserted) created += 1;
      for (const { topic, wordingVersion } of row.consent) {
        // An import never overrides a suppression or a withdrawal (6.3: most restrictive wins).
        const records = await this.deps.consent.record(contact.id, { topics: [topic], state: 'granted', method: 'import', wordingVersion }, { kind: 'staff', userId: actor });
        consents += records.length;
      }
      const ref = `${event.id}:${contact.id}`;
      await this.deps.touchpoints.recordOnce({ contactId: contact.id, channel: 'events', campaign, type: 'registration', occurredAt: registeredAt, sourceSystem: 'event_csv', sourceRef: ref });
      if (row.attended)
        await this.deps.touchpoints.recordOnce({ contactId: contact.id, channel: 'events', campaign, type: 'attendance', occurredAt: event.startsAt, sourceSystem: 'event_csv', sourceRef: `${ref}:checkin` });
    }
    return { rows: rows.length, newRegistrations: created, attended: rows.filter((row) => row.attended).length, consentRecords: consents };
  }

  private async manual(id: string) {
    const [event] = await this.deps.db.select().from(events).where(eq(events.id, id));
    if (!event) throw new ManualEventError('not_found', 'Unknown event');
    if (event.externalId) throw new ManualEventError('event_hub_owned', 'This event comes from Event Hub; change it there');
    return event;
  }

  private values(input: ManualEventInput) {
    return {
      title: input.title,
      type: input.type,
      startsAt: new Date(input.startsAt),
      language: input.language ?? null,
      public: input.public,
      registrationUrl: input.registrationUrl ?? null,
      registrationOpen: input.registrationOpen,
      recordingUrl: input.recordingUrl ?? null,
      photosUrl: input.photosUrl ?? null,
      mediaPublic: input.mediaPublic,
    };
  }

  private parse(csv: string, attendedByDefault: boolean): Row[] {
    const { rows } = parseCsv(csv, 5000);
    const [header, ...body] = rows;
    const columns = (header ?? []).map((name) => name.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    if (!columns.includes('email')) throw new ManualEventError('invalid_rows', 'The file needs an email column', [{ line: 1, message: 'Missing column: email' }]);
    const errors: { line: number; message: string }[] = [];
    const parsed: Row[] = [];
    const seen = new Set<string>();
    body.forEach((cells, index) => {
      const line = index + 2;
      const get = (name: string) => cells[columns.indexOf(name)]?.trim() || null;
      let email: string;
      try {
        email = normalizeEmail(get('email') ?? '');
      } catch (error) {
        errors.push({ line, message: error instanceof ContactFieldError ? error.message : 'Invalid email' });
        return;
      }
      if (seen.has(email)) return;
      seen.add(email);
      const language = get('language')?.toLowerCase() ?? null;
      if (language && !['hy', 'en', 'ru'].includes(language)) return void errors.push({ line, message: 'language must be hy, en or ru' });
      const registered = get('registered_at');
      const registeredAt = registered ? new Date(/T/.test(registered) ? registered : `${registered}T12:00:00+04:00`) : null;
      if (registeredAt && Number.isNaN(registeredAt.getTime())) return void errors.push({ line, message: 'registered_at must be a date (YYYY-MM-DD)' });
      const attendedCell = get('attended');
      if (attendedCell && !YES.test(attendedCell) && !NO.test(attendedCell)) return void errors.push({ line, message: 'attended must be yes or no' });
      const consent: Row['consent'] = [];
      for (const topic of TOPICS) {
        const version = get(`consent_${topic}`);
        if (!version) continue;
        const wording = findWording(version);
        if (!wording || wording.topic !== topic) return void errors.push({ line, message: `consent_${topic}: unknown wording version ${version}` });
        consent.push({ topic, wordingVersion: version });
      }
      parsed.push({
        line,
        email,
        firstName: get('first_name'),
        lastName: get('last_name'),
        phone: get('phone'),
        language: language as Row['language'],
        registeredAt,
        attended: attendedCell ? YES.test(attendedCell) : attendedByDefault,
        consent,
      });
    });
    if (errors.length) throw new ManualEventError('invalid_rows', `${errors.length} row(s) could not be read`, errors.slice(0, 50));
    return parsed;
  }
}
