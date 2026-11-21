import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { eventRegistrations, events, manualCosts, outcomes } from '../db/schema.js';
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
};

const DAY = 86_400_000;
const STAGES = ['lead', 'enrolled', 'hired'] as const;

/**
 * Events view (PRD 9.6, EVT-05): Event Hub (or manually entered) events as rows of the Events and open days
 * channel. Leads, enrolled and hired count registrants whose outcome came after they registered; cost is
 * everything recorded against the event's campaign. Small numbers are hidden outside marketing (ANL-14).
 */
export class EventsView {
  constructor(private readonly db: AppPgDatabase) {}

  async list(range: DateRange, shared: boolean) {
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
        }),
      ),
      totals: { costAmd: totals.cost, ...view(totals, totals.cost) },
    };
  }

  async exists(id: string) {
    const [row] = await this.db.select({ id: events.id }).from(events).where(eq(events.id, id));
    return Boolean(row);
  }
}
