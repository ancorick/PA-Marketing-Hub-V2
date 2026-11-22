import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, eventRegistrations, events, exportLog, manualCosts, outcomes } from '../db/schema.js';
import { MODEL_LABEL, type AttributionModel, type AttributionService } from '../analytics/attribution.js';
import { suppress, type Count } from '../analytics/overview.js';
import type { DateRange } from '../analytics/sources/contract.js';
import { eventCampaignKey } from './service.js';

export type EventRow = {
  id: string;
  externalId: string | null;
  title: string;
  type: string;
  startsAt: string;
  language: string | null;
  public: boolean;
  source: 'event_hub' | 'manual';
  campaign: string;
  costAmd: number;
  registrations: Count;
  attendees: Count;
  leads: Count;
  enrolled: Count;
  hired: Count;
  costPerAttendee: number | null;
  /** Registration page and media for the Events table (RESTRUCTURE R4). */
  registrationUrl: string | null;
  registrationOpen: boolean;
  recordingUrl: string | null;
  photosUrl: string | null;
  mediaPublic: boolean;
  /**
   * Outcomes in the period credited to the event's campaign by the chosen attribution model (events as a
   * channel, PRD 9.4); null when no model was asked for.
   */
  credited: { lead: Count; enrolled: Count; hired: Count } | null;
  costPerEnrolled: number | null;
};

const DAY = 86_400_000;
const STAGES = ['lead', 'enrolled', 'hired'] as const;

/**
 * Events view (PRD 9.6, EVT-05): Event Hub (or manually entered) events as rows of the Events and open days
 * channel. Leads, enrolled and hired count registrants whose outcome came after they registered; cost is
 * everything recorded against the event's campaign. Small numbers are hidden outside marketing (ANL-14).
 */
export class EventsView {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly attribution?: AttributionService,
  ) {}

  async list(range: DateRange, shared: boolean, model?: AttributionModel) {
    const start = new Date(`${range.from}T00:00:00+04:00`);
    const end = new Date(new Date(`${range.to}T00:00:00+04:00`).getTime() + DAY);
    const rows = await this.db.select().from(events).where(and(gte(events.startsAt, start), lt(events.startsAt, end))).orderBy(asc(events.startsAt));
    const ids = rows.map((row) => row.id);
    const registrations = ids.length
      ? await this.db
          .select({ eventId: eventRegistrations.eventId, contactId: eventRegistrations.contactId, status: eventRegistrations.status, registeredAt: eventRegistrations.registeredAt, checkedInAt: eventRegistrations.checkedInAt })
          .from(eventRegistrations)
          .where(inArray(eventRegistrations.eventId, ids))
      : [];
    const contactIds = [...new Set(registrations.map((row) => row.contactId).filter((id): id is string => id !== null))];
    const firstOutcome = new Map<string, Date>();
    for (let i = 0; i < contactIds.length; i += 1000) {
      const found = await this.db
        .select({ contactId: outcomes.contactId, type: outcomes.type, at: sql<Date>`min(${outcomes.occurredAt})` })
        .from(outcomes)
        .where(and(inArray(outcomes.contactId, contactIds.slice(i, i + 1000)), inArray(outcomes.type, [...STAGES])))
        .groupBy(outcomes.contactId, outcomes.type);
      for (const row of found) firstOutcome.set(`${row.contactId}|${row.type}`, new Date(row.at));
    }
    const keys = rows.map((row) => eventCampaignKey(row));
    const costRows = keys.length
      ? await this.db
          .select({ campaign: manualCosts.campaign, amount: sql<string>`sum(${manualCosts.amountAmd})` })
          .from(manualCosts)
          .where(and(inArray(manualCosts.campaign, keys), isNull(manualCosts.deletedAt)))
          .groupBy(manualCosts.campaign)
      : [];
    const costs = new Map(costRows.map((row) => [row.campaign, Number(row.amount)]));
    // Credited outcomes per event campaign under the model (only campaigns of the Events channel).
    const credited = new Map<string, { lead: number; enrolled: number; hired: number }>();
    if (model && this.attribution) {
      for (const row of await this.attribution.byCampaign(range, model, 'events')) credited.set(row.key, { lead: row.lead, enrolled: row.enrolled, hired: row.hired });
    }

    const raw = rows.map((event) => {
      const mine = registrations.filter((row) => row.eventId === event.id);
      const active = mine.filter((row) => row.status === 'registered' || row.checkedInAt);
      const attendees = mine.filter((row) => row.checkedInAt).length;
      const after = (stage: (typeof STAGES)[number]) =>
        new Set(active.filter((row) => row.contactId && (firstOutcome.get(`${row.contactId}|${stage}`)?.getTime() ?? 0) >= row.registeredAt.getTime()).map((row) => row.contactId)).size;
      const campaign = eventCampaignKey(event);
      return { event, campaign, cost: Math.round(costs.get(campaign) ?? 0), counts: { registrations: active.length, attendees, leads: after('lead'), enrolled: after('enrolled'), hired: after('hired') } };
    });
    const view = (counts: Record<'registrations' | 'attendees' | 'leads' | 'enrolled' | 'hired', number>, cost: number) => ({
      registrations: suppress(counts.registrations, shared),
      attendees: suppress(counts.attendees, shared),
      leads: suppress(counts.leads, shared),
      enrolled: suppress(counts.enrolled, shared),
      hired: suppress(counts.hired, shared),
      costPerAttendee: counts.attendees === 0 || suppress(counts.attendees, shared) !== counts.attendees ? null : Math.round(cost / counts.attendees),
    });
    const totals = raw.reduce(
      (sum, row) => ({
        cost: sum.cost + row.cost,
        registrations: sum.registrations + row.counts.registrations,
        attendees: sum.attendees + row.counts.attendees,
        leads: sum.leads + row.counts.leads,
        enrolled: sum.enrolled + row.counts.enrolled,
        hired: sum.hired + row.counts.hired,
      }),
      { cost: 0, registrations: 0, attendees: 0, leads: 0, enrolled: 0, hired: 0 },
    );
    return {
      period: range,
      shared,
      events: raw.map(
        ({ event, campaign, cost, counts }): EventRow => ({
          id: event.id,
          externalId: event.externalId,
          title: event.title,
          type: event.type,
          startsAt: event.startsAt.toISOString(),
          language: event.language,
          public: event.public,
          source: event.externalId ? 'event_hub' : 'manual',
          campaign,
          costAmd: cost,
          ...view(counts, cost),
          registrationUrl: event.registrationUrl,
          registrationOpen: event.registrationOpen,
          recordingUrl: event.recordingUrl,
          photosUrl: event.photosUrl,
          mediaPublic: event.mediaPublic,
          ...this.creditedView(credited.get(campaign), cost, shared, Boolean(model && this.attribution)),
        }),
      ),
      totals: {
        costAmd: totals.cost,
        ...view(totals, totals.cost),
        ...this.creditedView(
          raw.reduce(
            (sum, row) => {
              const item = credited.get(row.campaign);
              return item ? { lead: sum.lead + item.lead, enrolled: sum.enrolled + item.enrolled, hired: sum.hired + item.hired } : sum;
            },
            { lead: 0, enrolled: 0, hired: 0 },
          ),
          totals.cost,
          shared,
          Boolean(model && this.attribution),
        ),
      },
      model: model ?? null,
      modelLabel: model ? MODEL_LABEL[model] : null,
    };
  }

  private creditedView(values: { lead: number; enrolled: number; hired: number } | undefined, cost: number, shared: boolean, enabled: boolean) {
    if (!enabled) return { credited: null, costPerEnrolled: null };
    const round = (value: number) => Math.round(value * 100) / 100;
    const item = values ?? { lead: 0, enrolled: 0, hired: 0 };
    const enrolled = suppress(round(item.enrolled), shared);
    return {
      credited: { lead: suppress(round(item.lead), shared), enrolled, hired: suppress(round(item.hired), shared) },
      // A cost per person over 1 or 2 people would reveal the count.
      costPerEnrolled: typeof enrolled === 'number' && enrolled > 0 ? Math.round(cost / enrolled) : null,
    };
  }

  /**
   * Attendee list of one event as CSV (contact data: marketing roles only). Each download is recorded in the
   * export log, like segment exports (NFR-P4).
   */
  async attendeesCsv(id: string, actorId: string): Promise<{ title: string; csv: string; rows: number } | null> {
    const [event] = await this.db.select({ id: events.id, title: events.title }).from(events).where(eq(events.id, id));
    if (!event) return null;
    const rows = await this.db
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        language: contacts.language,
        status: eventRegistrations.status,
        registeredAt: eventRegistrations.registeredAt,
        checkedInAt: eventRegistrations.checkedInAt,
        source: eventRegistrations.source,
      })
      .from(eventRegistrations)
      .leftJoin(contacts, eq(contacts.id, eventRegistrations.contactId))
      .where(eq(eventRegistrations.eventId, id))
      .orderBy(asc(eventRegistrations.registeredAt));
    const cell = (value: string | null | undefined) => {
      const raw = value ?? '';
      const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ['first_name', 'last_name', 'email', 'language', 'registration', 'registered_at', 'attended', 'checked_in_at', 'source'];
    const lines = rows.map((row) =>
      [row.firstName, row.lastName, row.email, row.language, row.status, row.registeredAt.toISOString(), row.checkedInAt ? 'yes' : 'no', row.checkedInAt?.toISOString() ?? '', row.source].map(cell).join(','),
    );
    await this.db.insert(exportLog).values({ actorId, kind: 'event_attendees', segmentName: event.title, rowCount: rows.length });
    return { title: event.title, csv: `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`, rows: rows.length };
  }

  async exists(id: string) {
    const [row] = await this.db.select({ id: events.id }).from(events).where(eq(events.id, id));
    return Boolean(row);
  }
}
