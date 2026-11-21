import { and, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { auditEvents, consentRecords, contacts, deliveries, sends, touchpoints } from '../db/schema.js';
import type { Language } from '../integrations/core-engine/contract.js';
import type { JobResult } from '../jobs/runner.js';

const DAY = 86_400_000;

/** EML-15: 12 months without an open or click → re-engagement email; 30 more days of silence → out of regular sends. */
export const SUNSET = { quietDays: 365, graceDays: 30 } as const;

const COPY: Record<Language, { subject: string; body: string; button: string }> = {
  en: {
    subject: 'Do you still want to hear from Picsart Academy?',
    body: 'Hi {{first_name}},\n\nWe have not seen you open our emails for a year, so we will stop sending them soon. If you would like to keep receiving news about courses and events, press the button below.\n\nIf not, there is nothing to do: we will simply stop writing.',
    button: 'Yes, keep me subscribed',
  },
  hy: {
    subject: 'Դեռ ցանկանո՞ւմ եք նամակներ ստանալ Picsart Academy-ից',
    body: 'Բարև, {{first_name}},\n\nՄեկ տարի է՝ չեք բացել մեր նամակները, ուստի շուտով կդադարենք դրանք ուղարկել։ Եթե ցանկանում եք շարունակել ստանալ դասընթացների և միջոցառումների մասին նորություններ, սեղմեք ներքևի կոճակը։\n\nԵթե ոչ, ոչինչ անել պետք չէ․ մենք պարզապես կդադարենք գրել։',
    button: 'Այո, ուզում եմ ստանալ',
  },
  ru: {
    subject: 'Вы ещё хотите получать письма Picsart Academy?',
    body: 'Здравствуйте, {{first_name}}!\n\nВы не открывали наши письма уже год, поэтому скоро мы перестанем их присылать. Если хотите и дальше получать новости о курсах и мероприятиях, нажмите кнопку ниже.\n\nЕсли нет — ничего делать не нужно: мы просто перестанем писать.',
    button: 'Да, хочу получать',
  },
};

/** "Picsart Academy <news@x>" → name and address. */
function splitFrom(from: string): { name: string; address: string } {
  const match = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  return match ? { name: match[1] || 'Picsart Academy', address: (match[2] as string).trim() } : { name: 'Picsart Academy', address: from.trim() };
}

const engagedSince = (since: Date | ReturnType<typeof sql>) =>
  sql`exists (select 1 from ${touchpoints} where ${touchpoints.contactId} = ${contacts.id} and ${touchpoints.type} in ('open', 'click') and ${touchpoints.occurredAt} >= ${since})`;

/** Latest consent record per topic is granted for at least one topic. */
const anyGranted = sql`exists (select 1 from ${consentRecords} cr where cr.contact_id = ${contacts.id} and cr.state = 'granted'
  and not exists (select 1 from ${consentRecords} newer where newer.contact_id = cr.contact_id and newer.topic = cr.topic and newer.created_at > cr.created_at))`;

/**
 * Sunset policy (EML-15), run daily: first moves contacts who ignored their re-engagement email for 30 days
 * out of regular sends (contacts.sunset_at; segments leave them out), then sends a re-engagement email,
 * per language, to contacts who have received marketing email for a year without one open or click.
 * Any later open or click, or "keep me subscribed", brings a contact back.
 */
export class SunsetPolicy {
  constructor(
    private readonly deps: { db: AppPgDatabase; mailFrom: string; now?: () => Date },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async run(): Promise<JobResult> {
    const now = this.now();
    const quietSince = new Date(now.getTime() - SUNSET.quietDays * DAY);

    // 1. Silence after the re-engagement email: out of regular sends.
    const sunset = await this.deps.db
      .update(contacts)
      .set({ sunsetAt: now })
      .where(
        and(
          isNull(contacts.sunsetAt),
          isNotNull(contacts.reengagementSentAt),
          lte(contacts.reengagementSentAt, new Date(now.getTime() - SUNSET.graceDays * DAY)),
          sql`not ${engagedSince(sql`${contacts.reengagementSentAt}`)}`,
        ),
      )
      .returning({ id: contacts.id });
    if (sunset.length > 0) {
      await this.deps.db.insert(auditEvents).values(sunset.map((row) => ({ entityType: 'contact', entityId: row.id, action: 'contact.updated', actorId: 'sunset_policy', fields: ['sunsetAt'] })));
    }

    // 2. A year of email without a single open or click: one re-engagement email.
    const candidates = await this.deps.db
      .select({ id: contacts.id, email: contacts.email, language: contacts.language })
      .from(contacts)
      .where(
        and(
          eq(contacts.status, 'active'),
          isNotNull(contacts.email),
          isNull(contacts.sunsetAt),
          or(isNull(contacts.reengagementSentAt), lte(contacts.reengagementSentAt, quietSince)),
          sql`exists (select 1 from ${deliveries} where ${deliveries.contactId} = ${contacts.id} and ${deliveries.sentAt} <= ${quietSince})`,
          sql`not ${engagedSince(quietSince)}`,
          anyGranted,
        ),
      );
    const from = splitFrom(this.deps.mailFrom);
    for (const language of ['hy', 'en', 'ru'] as const) {
      const group = candidates.filter((candidate) => candidate.language === language);
      if (group.length === 0) continue;
      const copy = COPY[language];
      await this.deps.db.transaction(async (tx) => {
        const [send] = await tx
          .insert(sends)
          .values({
            name: `Re-engagement ${now.toISOString().slice(0, 10)} (${language})`,
            kind: 'reengagement',
            topic: 'newsletter',
            purpose: 'other',
            segmentId: null,
            language,
            fromName: from.name,
            fromAddress: from.address,
            subject: copy.subject,
            body: copy.body,
            buttonLabel: copy.button,
            utmCampaign: 'reengagement',
            status: 'scheduled',
            scheduledAt: now,
            approvedBy: 'sunset_policy',
            approvedAt: now,
            createdBy: 'sunset_policy',
          })
          .returning({ id: sends.id });
        const sendId = (send as { id: string }).id;
        await tx.insert(deliveries).values(group.map((contact) => ({ sendId, contactId: contact.id, email: contact.email })));
        for (let i = 0; i < group.length; i += 1000) {
          await tx
            .update(contacts)
            .set({ reengagementSentAt: now })
            .where(sql`${contacts.id} in (${sql.join(group.slice(i, i + 1000).map((contact) => sql`${contact.id}`), sql`, `)})`);
        }
      });
    }
    return { rowsIn: candidates.length + sunset.length, rowsUpserted: candidates.length + sunset.length };
  }

  /** Engagement brings a contact back into regular sends (an open, a click, or "keep me subscribed"). */
  async reactivate(contactId: string): Promise<void> {
    const rows = await this.deps.db
      .update(contacts)
      .set({ sunsetAt: null, reengagementSentAt: null })
      .where(and(eq(contacts.id, contactId), or(isNotNull(contacts.sunsetAt), isNotNull(contacts.reengagementSentAt))))
      .returning({ id: contacts.id });
    if (rows.length > 0) {
      await this.deps.db.insert(auditEvents).values({ entityType: 'contact', entityId: contactId, action: 'contact.updated', actorId: 'sunset_policy', fields: ['sunsetAt'] });
    }
  }
}
