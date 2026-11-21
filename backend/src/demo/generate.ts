/**
 * Synthetic demo data set (docs/RESTRUCTURE.md R2): about 1,800 contacts over 18 months with consents, touches
 * and outcomes, costs and exchange rates, events, newsletter issues, campaign sends with their deliveries, and
 * the operational records around them (sync runs, alerts, activity, unmapped utm values).
 *
 * A pure function of `now`: the same day always gives the same rows (IDs, names, numbers and dates); a later
 * day gives the same people and numbers with the dates moved along, so the data never goes stale. Nothing here
 * touches the database; src/demo/seed.ts loads the result.
 */
import type { PgTable } from 'drizzle-orm/pg-core';
import { SOURCE_GROUPS, type SourceGroup } from '../analytics/self-reported.js';
import { MockExchangeRateClient } from '../analytics/sources/mock.js';
import { slug } from '../analytics/links.js';
import { isoWeek } from '../analytics/metrics.js';
import { channelFromUtm } from '../contacts/channels.js';
import { emailKey, hashEmail, type ChannelId, type ContactType } from '../contacts/fields.js';
import * as schema from '../db/schema.js';
import { eventCampaignKey } from '../eventhub/service.js';
import { DEFAULT_THEME } from '../email/render.js';
import { ACTIVE_ADMISSION_STAGES } from '../sync/service.js';
import type { CrmStage } from '../integrations/navigator-crm/contract.js';
import { COURSES, EMAIL_DOMAINS, EN_FIRST, EN_LAST, EVENT_KINDS, HY_FIRST, HY_LAST, MONTHS, NEWSLETTER, RU_FIRST, RU_LAST, SELF_REPORTED, type EventType, type Lang } from './content.js';
import { demoId, Random } from './random.js';

type Row<T extends PgTable> = T['$inferInsert'];

export const DEMO_VERSION = 1;
export const DEMO_MONTHS = 18;
export const DEMO_CONTACTS = 1800;

const IMPORT_FAIR = 90;
const IMPORT_LEGACY = 40;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Yerevan is UTC+4 all year. */
const YEREVAN = 4 * HOUR;

const dayOf = (moment: Date) => new Date(moment.getTime() + YEREVAN).toISOString().slice(0, 10);
const at = (day: string, hour = 12, minute = 0) => new Date(Date.parse(`${day}T00:00:00Z`) - YEREVAN + hour * HOUR + minute * MINUTE);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthsBack = (day: string, n: number) => {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
};
const monthEnd = (first: string) => {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const plus = (moment: Date, ms: number) => new Date(moment.getTime() + ms);
const between = (rng: Random, from: Date, to: Date) => new Date(from.getTime() + Math.floor(rng.next() * Math.max(0, to.getTime() - from.getTime())));
const latest = (...moments: (Date | null | undefined)[]) => new Date(Math.max(...moments.filter((m): m is Date => Boolean(m)).map((m) => m.getTime())));

/**
 * Central Bank of Armenia style rates for the demo: close to the mock client's levels, moving slowly from day
 * to day. A function of the date only, so every cost on the same day uses the same rate.
 */
export function demoRate(currency: string, day: string): number {
  const base = MockExchangeRateClient.RATES[currency.toUpperCase()];
  if (!base || base === 1) return 1;
  const t = Date.parse(`${day}T00:00:00Z`) / DAY;
  const wave = 0.018 * Math.sin(t / 47 + currency.length) + 0.006 * Math.sin(t / 11 + (currency.charCodeAt(0) % 7));
  const scale = base < 10 ? 1000 : 100;
  return Math.round(base * (1 + wave) * scale) / scale;
}

/* ---------- Channels, campaigns and quality ---------- */

type Source = ChannelId | 'unattributed' | 'unmapped';

const SOURCE_MIX: [Source, number][] = [
  ['paid_social', 24], ['organic_social', 13], ['search_website', 15], ['paid_search', 10], ['email', 4], ['events', 12],
  ['referrals', 10], ['chatbot', 3], ['partners_press', 5], ['unattributed', 3], ['unmapped', 2.5],
];

/** How well a channel converts relative to average: referrals and events bring the most committed people. */
const QUALITY: Record<Source, number> = {
  paid_social: 0.8, organic_social: 0.9, search_website: 1, paid_search: 1.05, email: 1.1, events: 1.3,
  referrals: 1.45, chatbot: 0.8, partners_press: 1.1, unattributed: 1, unmapped: 0.85,
};

const GROUP: Record<ChannelId, SourceGroup> = {
  paid_social: 'social', organic_social: 'social', search_website: 'search_website', paid_search: 'search_website', email: 'email',
  events: 'events', referrals: 'referrals', chatbot: 'chatbot', partners_press: 'partners_press',
};

const UTM: Partial<Record<ChannelId, [string, string][]>> = {
  paid_social: [['instagram', 'paid_social'], ['facebook', 'paid_social']],
  organic_social: [['instagram', 'social'], ['facebook', 'social'], ['linkedin', 'social']],
  search_website: [['google', 'organic']],
  paid_search: [['google', 'cpc']],
  email: [['newsletter', 'email']],
  referrals: [['alumni', 'referral']],
  chatbot: [['chatbot', 'chat']],
  partners_press: [['partner-site', 'partner']],
};

/** Parameters no built-in rule maps: they wait in the taxonomy review queue (ANL-03). */
const UNMAPPED_UTM: [string, string][] = [['tiktok', 'influencer'], ['telegram', 'channel'], ['fb', 'story']];
/** Mapped by a staff rule when its review-queue entry was resolved. */
const RESOLVED_UTM: [string, string] = ['linkedin', 'inmail'];

/** Multiplier for the number of first touches by calendar month: intakes in spring and autumn. */
const SEASON = [0.9, 1.15, 1.2, 1, 0.85, 0.8, 0.85, 1.25, 1.35, 1.1, 0.95, 0.75];

type AdCampaign = { platform: 'meta_ads' | 'google_ads'; id: string; name: string; utm: string; currency: 'USD' | 'AMD'; spend: [number, number]; weight: number };

type DemoEvent = {
  n: number;
  id: string;
  externalId: string | null;
  title: string;
  type: EventType;
  language: Lang;
  day: string;
  startsAt: Date;
  public: boolean;
  campaign: string;
};

type Registration = Row<typeof schema.eventRegistrations> & { eventId: string; contactId: string; registeredAt: Date };

type Leave = { at: Date; reason: 'unsubscribed' | 'bounced' | 'complained'; source: string; viaEmail: boolean };

type Person = {
  n: number;
  id: string;
  language: Lang;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: Source;
  channel: ChannelId | null;
  campaign: string | null;
  utm: [string, string] | null;
  firstTouchAt: Date;
  createdAt: Date;
  importId: string | null;
  course: (typeof COURSES)[number];
  lead: Date | null;
  applied: Date | null;
  enrolled: Date | null;
  completed: Date | null;
  hired: Date | null;
  crmStage: CrmStage | null;
  type: ContactType;
  employment: string | null;
  selfReported: string | null;
  consents: Partial<Record<'newsletter' | 'courses' | 'events' | 'alumni', Date>>;
  pending: boolean;
  leave: Leave | null;
  blockedAt: Date | null;
  tags: string[];
  frequency: 'all' | 'monthly';
  touches: number;
};

export type DemoData = {
  sendingDomains: Row<typeof schema.sendingDomains>[];
  contactImports: Row<typeof schema.contactImports>[];
  contacts: Row<typeof schema.contacts>[];
  consentRecords: Row<typeof schema.consentRecords>[];
  suppressions: Row<typeof schema.suppressions>[];
  touchpoints: Row<typeof schema.touchpoints>[];
  outcomes: Row<typeof schema.outcomes>[];
  events: Row<typeof schema.events>[];
  eventRegistrations: Row<typeof schema.eventRegistrations>[];
  segments: Row<typeof schema.segments>[];
  segmentMembers: Row<typeof schema.segmentMembers>[];
  manualCosts: Row<typeof schema.manualCosts>[];
  adSpendDaily: Row<typeof schema.adSpendDaily>[];
  webTrafficDaily: Row<typeof schema.webTrafficDaily>[];
  socialDaily: Row<typeof schema.socialDaily>[];
  newsletterTemplates: Row<typeof schema.newsletterTemplates>[];
  newsletterCadences: Row<typeof schema.newsletterCadences>[];
  collectedItems: Row<typeof schema.collectedItems>[];
  issues: Row<typeof schema.issues>[];
  issueBlocks: Row<typeof schema.issueBlocks>[];
  issueEdits: Row<typeof schema.issueEdits>[];
  issueComments: Row<typeof schema.issueComments>[];
  sends: Row<typeof schema.sends>[];
  deliveries: Row<typeof schema.deliveries>[];
  linkClicks: Row<typeof schema.linkClicks>[];
  dmarcReports: Row<typeof schema.dmarcReports>[];
  dmarcRecords: Row<typeof schema.dmarcRecords>[];
  channelRules: Row<typeof schema.channelRules>[];
  unmappedValues: Row<typeof schema.unmappedValues>[];
  trackedLinks: Row<typeof schema.trackedLinks>[];
  syncRuns: Row<typeof schema.syncRuns>[];
  alerts: Row<typeof schema.alerts>[];
  auditEvents: Row<typeof schema.auditEvents>[];
  exportLog: Row<typeof schema.exportLog>[];
  staffActivity: Row<typeof schema.staffActivity>[];
  appSettings: Row<typeof schema.appSettings>[];
};

const STAFF = { editor: 'staff-editor', manager: 'staff-marketing_manager', admin: 'staff-admin' } as const;
const SITE = 'https://academy.example.test';

export function generateDemoData({ now }: { now: Date }): DemoData {
  return new DemoBuilder(now).build();
}

class DemoBuilder {
  readonly today: string;
  readonly start: string;
  readonly data: DemoData = {
    sendingDomains: [], contactImports: [], contacts: [], consentRecords: [], suppressions: [], touchpoints: [], outcomes: [], events: [],
    eventRegistrations: [], segments: [], segmentMembers: [], manualCosts: [], adSpendDaily: [], webTrafficDaily: [], socialDaily: [],
    newsletterTemplates: [], newsletterCadences: [], collectedItems: [], issues: [], issueBlocks: [], issueEdits: [], issueComments: [],
    sends: [], deliveries: [], linkClicks: [], dmarcReports: [], dmarcRecords: [], channelRules: [], unmappedValues: [], trackedLinks: [],
    syncRuns: [], alerts: [], auditEvents: [], exportLog: [], staffActivity: [], appSettings: [],
  };
  private readonly people: Person[] = [];
  private readonly calendar: DemoEvent[] = [];
  private readonly registrations: Registration[] = [];
  private readonly emails = new Set<string>();
  private readonly names = new Set<string>();
  private readonly segmentIds = new Map<string, string>();
  private touchSeq = 0;
  private importFair!: { id: string; at: Date; fileName: string };
  private importLegacy!: { id: string; at: Date; fileName: string };

  constructor(private readonly now: Date) {
    this.today = dayOf(now);
    this.start = monthsBack(this.today, DEMO_MONTHS - 1);
  }

  build(): DemoData {
    this.buildEvents();
    this.buildImports();
    this.buildPeople();
    this.buildGraduationGuests();
    this.buildBackgroundLeaves();
    this.buildSegments();
    const newsletter = this.buildNewsletter();
    this.buildSends(newsletter);
    this.finishPeople();
    this.buildEventRows();
    this.buildCosts();
    this.buildChannelData();
    this.buildTaxonomy();
    this.buildEmailSetup();
    this.buildOperations();
    return this.data;
  }

  private past(moment: Date) {
    return moment.getTime() < this.now.getTime() - 5 * MINUTE;
  }

  /* ---------- Events (EVT-05) ---------- */

  private buildEvents() {
    const rng = new Random('events');
    const cycle: EventType[] = ['open_day', 'workshop', 'info_session', 'meetup', 'open_day', 'graduation', 'workshop', 'info_session', 'open_day', 'meetup', 'workshop', 'graduation'];
    const used = new Map<EventType, number>();
    const add = (type: EventType, day: string, manual: boolean) => {
      const n = this.calendar.length + 1;
      const kind = EVENT_KINDS[type];
      const index = used.get(type) ?? 0;
      used.set(type, index + 1);
      const id = demoId('event', n);
      const externalId = manual ? null : `demo-evt-${String(n).padStart(4, '0')}`;
      this.calendar.push({
        n, id, externalId, type, day,
        title: kind.titles[index % kind.titles.length] as string,
        language: kind.language,
        startsAt: at(day, kind.hour, 30),
        public: kind.public,
        campaign: eventCampaignKey({ externalId, id }),
      });
    };
    for (let back = DEMO_MONTHS - 1; back >= 0; back -= 1) {
      const day = addDays(monthsBack(this.today, back), rng.int(12, 21));
      const type = cycle[(DEMO_MONTHS - 1 - back) % cycle.length] as EventType;
      if (!this.past(at(day, EVENT_KINDS[type].hour, 30))) continue;
      add(type, day, back === 14 || back === 7);
    }
    add('open_day', addDays(this.today, 6), false);
    add('workshop', addDays(this.today, 16), false);
    add('info_session', addDays(this.today, 30), true);
  }

  /** The event a first touch registered for: the next one within 30 days. */
  private eventAfter(moment: Date) {
    return this.calendar.find((event) => event.public && event.startsAt > moment && event.startsAt.getTime() - moment.getTime() <= 30 * DAY) ?? null;
  }

  private register(rng: Random, person: Person, event: DemoEvent, registeredAt: Date, utm: [string, string] | null) {
    if (this.registrations.some((row) => row.eventId === event.id && row.contactId === person.id)) return;
    const n = this.registrations.length + 1;
    const happened = this.past(event.startsAt);
    const cancelled = rng.chance(0.05);
    const checkedInAt = happened && !cancelled && rng.chance(0.68) ? plus(event.startsAt, rng.int(-10, 40) * MINUTE) : null;
    const cancelledAt = cancelled ? between(rng, registeredAt, event.startsAt < this.now ? event.startsAt : this.now) : null;
    const source = event.externalId ? 'event_hub' : 'manual';
    this.registrations.push({
      id: demoId('registration', n),
      externalId: event.externalId ? `demo-reg-${String(n).padStart(5, '0')}` : null,
      eventExternalId: event.externalId,
      eventId: event.id,
      contactId: person.id,
      status: cancelled ? 'cancelled' : 'registered',
      registeredAt,
      cancelledAt,
      checkedInAt,
      utmSource: utm?.[0] ?? null,
      utmMedium: utm?.[1] ?? null,
      utmCampaign: utm ? event.campaign : null,
      source,
      createdAt: registeredAt,
      updatedAt: latest(registeredAt, cancelledAt, checkedInAt),
    });
    this.touch(person, { channel: 'events', campaign: event.campaign, type: 'registration', at: registeredAt, system: source, ref: `demo-reg-${n}` });
    if (checkedInAt) this.touch(person, { channel: 'events', campaign: event.campaign, type: 'attendance', at: checkedInAt, system: source, ref: `demo-reg-${n}:checkin` });
    person.consents.events ??= registeredAt;
  }

  /* ---------- Imports (AUD-03, 7.4) ---------- */

  private buildImports() {
    const fairAt = at(addDays(monthsBack(this.today, 9), 11), 16, 5);
    const legacyAt = at(addDays(this.today, -58), 10, 40);
    this.importFair = { id: demoId('import', 'fair'), at: fairAt, fileName: 'Partner university career fair.csv' };
    this.importLegacy = { id: demoId('import', 'legacy'), at: legacyAt, fileName: 'Legacy newsletter list.csv' };
    for (const [item, rows] of [[this.importFair, IMPORT_FAIR], [this.importLegacy, IMPORT_LEGACY]] as const) {
      this.data.contactImports.push({
        id: item.id,
        fileName: item.fileName,
        actorId: STAFF.editor,
        rowsTotal: rows + 3,
        created: rows,
        updated: 0,
        invalid: 3,
        settings: { delimiter: ',', columns: { email: 'Email', firstName: 'First name', lastName: 'Last name', language: 'Language' }, consentMethod: 'import' },
        createdAt: item.at,
        updatedAt: item.at,
      });
    }
  }

  /* ---------- People, funnel, consents and touches ---------- */

  private buildPeople() {
    const rng = new Random('people');
    const organic = DEMO_CONTACTS - IMPORT_FAIR - IMPORT_LEGACY;
    // Contacts per first-touch month: growing, seasonal, the current month only up to today.
    const months = Array.from({ length: DEMO_MONTHS }, (_, i) => monthsBack(this.today, DEMO_MONTHS - 1 - i));
    const weights = months.map((first, i) => {
      const last = monthEnd(first);
      const days = daysBetween(first, last) + 1;
      const open = Math.max(0, Math.min(days, daysBetween(first, this.today)));
      return (1 + i * 0.045) * (SEASON[Number(first.slice(5, 7)) - 1] as number) * (open / days);
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    const exact = weights.map((w) => (w / total) * organic);
    const counts = exact.map(Math.floor);
    const order = exact.map((value, i) => [value - Math.floor(value), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const missing = organic - counts.reduce((sum, c) => sum + c, 0);
    for (let k = 0; k < missing; k += 1) {
      const index = (order[k] as readonly [number, number])[1];
      counts[index] = (counts[index] ?? 0) + 1;
    }

    const firstTouches: Date[] = [];
    months.forEach((first, i) => {
      const lastDay = monthEnd(first) < addDays(this.today, -1) ? monthEnd(first) : addDays(this.today, -1);
      const span = Math.max(0, daysBetween(first, lastDay));
      for (let k = 0; k < (counts[i] as number); k += 1) firstTouches.push(at(addDays(first, rng.int(0, span)), rng.int(8, 22), rng.int(0, 59)));
    });
    firstTouches.sort((a, b) => a.getTime() - b.getTime());

    firstTouches.forEach((firstTouchAt, i) => {
      if (i % 210 === 209) {
        this.addDuplicate(this.people[this.people.length - 40] as Person, firstTouchAt, i % 420 === 419);
        return;
      }
      const language = rng.weighted<Lang>([['hy', 56], ['en', 19], ['ru', 25]]);
      this.addPerson(rng, { language, firstTouchAt, source: rng.weighted(SOURCE_MIX), importId: null });
    });
    for (let k = 0; k < IMPORT_FAIR; k += 1) {
      const language = rng.weighted<Lang>([['hy', 70], ['en', 15], ['ru', 15]]);
      this.addPerson(rng, { language, firstTouchAt: this.importFair.at, source: 'partners_press', importId: this.importFair.id, campaign: 'university-career-fair' });
    }
    for (let k = 0; k < IMPORT_LEGACY; k += 1) {
      this.addPerson(rng, { language: 'en', firstTouchAt: this.importLegacy.at, source: 'email', importId: this.importLegacy.id, campaign: 'legacy-list', subscriberOnly: true });
    }
  }

  /**
   * A full name nobody else in the set has, so the fuzzy name match of duplicate detection (AUD-04) only
   * finds the duplicates planted on purpose.
   */
  private name(rng: Random, language: Lang) {
    let name = this.drawName(rng, language);
    for (let attempt = 0; attempt < 40 && this.names.has(name.latin.join(' ')); attempt += 1) name = this.drawName(rng, language);
    this.names.add(name.latin.join(' '));
    return name;
  }

  private drawName(rng: Random, language: Lang) {
    if (language === 'ru') {
      const [first, firstLatin, gender] = rng.pick(RU_FIRST);
      const [male, female, lastLatin] = rng.pick(RU_LAST);
      const cyrillic = rng.chance(0.85);
      const last = gender === 'f' ? female : male;
      const latinLast = gender === 'f' ? `${lastLatin}a` : lastLatin;
      return { firstName: cyrillic ? first : firstLatin, lastName: cyrillic ? last : latinLast, latin: [firstLatin, latinLast] as const };
    }
    if (language === 'hy' || rng.chance(0.25)) {
      const [first, firstLatin] = rng.pick(HY_FIRST);
      const [last, lastLatin] = rng.pick(HY_LAST);
      const native = language === 'hy' && rng.chance(0.65);
      return { firstName: native ? first : firstLatin, lastName: native ? last : lastLatin, latin: [firstLatin, lastLatin] as const };
    }
    const first = rng.pick(EN_FIRST);
    const last = rng.pick(EN_LAST);
    return { firstName: first, lastName: last, latin: [first, last] as const };
  }

  private email(rng: Random, [first, last]: readonly [string, string]) {
    const f = first.toLowerCase();
    const l = last.toLowerCase();
    const styles = [`${f}.${l}`, `${f}${l}`, `${f}_${l}`, `${f[0]}.${l}`, `${f}.${l}${rng.int(80, 99)}`];
    let local = rng.pick(styles);
    const domain = rng.pick(EMAIL_DOMAINS);
    for (let k = 2; this.emails.has(`${local}@${domain}`); k += 1) local = `${rng.pick(styles)}${k}`;
    this.emails.add(`${local}@${domain}`);
    return `${local}@${domain}`;
  }

  private addPerson(
    rng: Random,
    input: { language: Lang; firstTouchAt: Date; source: Source; importId: string | null; campaign?: string; subscriberOnly?: boolean },
  ) {
    const n = this.people.length + 1;
    const name = this.name(rng, input.language);
    let source = input.source;
    const firstTouchAt = input.firstTouchAt;
    let event: DemoEvent | null = null;
    if (source === 'events') {
      event = this.eventAfter(firstTouchAt);
      if (!event) source = 'search_website';
    }
    const channel: ChannelId | null = source === 'unattributed' || source === 'unmapped' ? null : source;
    const utm = source === 'unmapped' ? rng.pick([...UNMAPPED_UTM, RESOLVED_UTM]) : channel && UTM[channel] && !(channel === 'search_website' && rng.chance(0.4)) ? rng.pick(UTM[channel] as [string, string][]) : null;
    const person: Person = {
      n,
      id: demoId('contact', n),
      language: input.language,
      firstName: name.firstName,
      lastName: name.lastName,
      email: this.email(rng, name.latin),
      phone: rng.chance(0.6) ? `+37400${String(100_000 + n).padStart(6, '0')}` : null,
      source,
      // A staff rule maps linkedin/inmail to organic social; the other unmapped values stay without a channel.
      channel: utm && utm[0] === RESOLVED_UTM[0] && utm[1] === RESOLVED_UTM[1] ? 'organic_social' : channel,
      campaign: input.campaign ?? this.campaignFor(rng, source, firstTouchAt, event),
      utm,
      firstTouchAt,
      createdAt: firstTouchAt,
      importId: input.importId,
      course: rng.weighted(COURSES.map((course) => [course, course.weight] as const)),
      lead: null, applied: null, enrolled: null, completed: null, hired: null,
      crmStage: null,
      type: 'subscriber',
      employment: null,
      selfReported: null,
      consents: {},
      pending: false,
      leave: null,
      blockedAt: null,
      tags: [],
      frequency: rng.chance(0.05) ? 'monthly' : 'all',
      touches: 0,
    };
    if (!input.subscriberOnly) this.funnel(rng, person);
    this.consent(rng, person);
    this.people.push(person);
    if (input.importId) {
      person.consents.newsletter = firstTouchAt;
      if (input.subscriberOnly) person.consents.courses = firstTouchAt;
      return person;
    }
    this.touches(rng, person, event);
    return person;
  }

  /** Graduations are private: their guests are the people who completed a course in the weeks before. */
  private buildGraduationGuests() {
    const rng = new Random('graduations');
    for (const event of this.calendar.filter((item) => item.type === 'graduation' && this.past(item.startsAt))) {
      for (const person of this.people) {
        if (!person.completed || person.completed > event.startsAt || event.startsAt.getTime() - person.completed.getTime() > 60 * DAY) continue;
        if (rng.chance(0.8)) this.register(rng, person, event, plus(event.startsAt, -rng.int(5, 12) * DAY), null);
      }
    }
  }

  /** A second record for someone already known: same email with a plus tag, or the same phone (AUD-04). */
  private addDuplicate(original: Person, firstTouchAt: Date, samePhone: boolean) {
    const n = this.people.length + 1;
    const [local, domain] = original.email.split('@') as [string, string];
    const email = samePhone ? `${local}.work@${domain}` : `${local}+news@${domain}`;
    this.emails.add(email);
    const person: Person = {
      ...original,
      n,
      id: demoId('contact', n),
      email,
      phone: samePhone ? (original.phone ?? `+37400${String(100_000 + original.n).padStart(6, '0')}`) : null,
      source: 'search_website',
      channel: 'search_website',
      campaign: null,
      utm: null,
      firstTouchAt,
      createdAt: firstTouchAt,
      importId: null,
      lead: null, applied: null, enrolled: null, completed: null, hired: null,
      crmStage: null,
      type: 'subscriber',
      employment: null,
      selfReported: null,
      consents: { newsletter: firstTouchAt },
      pending: false,
      leave: null,
      blockedAt: null,
      tags: [],
      touches: 0,
    };
    if (samePhone && !original.phone) original.phone = person.phone;
    this.people.push(person);
    this.touch(person, { channel: 'search_website', campaign: null, type: 'form', at: firstTouchAt, system: 'website', ref: null });
  }

  private campaignFor(rng: Random, source: Source, moment: Date, event: DemoEvent | null): string | null {
    const day = dayOf(moment);
    switch (source) {
      case 'paid_social':
        return rng.weighted(this.metaCampaigns(day).map((campaign) => [campaign.utm, campaign.weight] as const));
      case 'paid_search':
        return rng.chance(0.55) ? 'brand-search' : 'generic-courses';
      case 'organic_social':
        return rng.chance(0.3) ? 'instagram-reels' : null;
      case 'email':
        return 'newsletter-forward';
      case 'events':
        return event?.campaign ?? null;
      case 'referrals':
        return 'alumni-referral';
      case 'partners_press':
        return rng.chance(0.6) ? 'university-partners' : 'tech-press';
      case 'unmapped':
        return 'creator-test';
      default:
        return null;
    }
  }

  /** Lead → applied → enrolled → completed → hired; a later stage only once its date has passed (maturing cohorts). */
  private funnel(rng: Random, person: Person) {
    const q = QUALITY[person.source];
    const ok = (moment: Date) => this.past(moment);
    if (rng.chance(Math.min(0.85, 0.5 * q))) {
      const lead = rng.chance(0.35) ? plus(person.firstTouchAt, rng.int(2, 30) * MINUTE) : plus(person.firstTouchAt, rng.int(1, 45) * DAY + rng.int(0, 600) * MINUTE);
      if (ok(lead)) person.lead = lead;
    }
    if (person.lead && rng.chance(Math.min(0.8, 0.42 * q))) {
      const applied = plus(person.lead, rng.int(4, 50) * DAY + rng.int(0, 600) * MINUTE);
      if (ok(applied)) person.applied = applied;
    }
    if (person.applied && rng.chance(Math.min(0.85, 0.6 * Math.min(q, 1.25)))) {
      const ready = addDays(dayOf(person.applied), rng.int(7, 35));
      const groupStart = monthsBack(ready, -1);
      const enrolled = at(groupStart, 10, 0);
      if (ok(enrolled)) person.enrolled = enrolled;
    }
    if (person.enrolled && rng.chance(0.85)) {
      const completed = at(addDays(dayOf(person.enrolled), rng.int(150, 210)), 15, 0);
      if (ok(completed)) person.completed = completed;
    }
    if (person.completed && rng.chance(Math.min(0.85, 0.58 * Math.min(q, 1.3)))) {
      const hired = at(addDays(dayOf(person.completed), rng.int(20, 240)), 9, 0);
      if (ok(hired)) person.hired = hired;
    }
    const age = (moment: Date) => (this.now.getTime() - moment.getTime()) / DAY;
    if (person.enrolled) person.crmStage = 'enrolled';
    else if (person.applied) person.crmStage = age(person.applied) < 45 ? rng.pick<CrmStage>(['applied', 'interview', 'accepted']) : rng.weighted<CrmStage>([['rejected', 6], ['lost', 4]]);
    else if (person.lead) person.crmStage = age(person.lead) < 30 ? rng.pick<CrmStage>(['new', 'contacted']) : rng.weighted<CrmStage>([['contacted', 4], ['lost', 6]]);
    person.type = person.completed
      ? 'alumnus'
      : person.enrolled
        ? 'student'
        : person.crmStage && ['applied', 'interview', 'accepted'].includes(person.crmStage)
          ? 'applicant'
          : person.lead
            ? 'lead'
            : 'subscriber';
    if (person.completed) person.employment = person.hired ? 'employed' : rng.weighted([['seeking', 6], ['not_seeking', 4]]);
    if (person.applied && rng.chance(0.75)) {
      const truth: SourceGroup = person.channel ? GROUP[person.channel] : rng.pick(SOURCE_GROUPS);
      const group = rng.chance(0.18) ? rng.pick(SOURCE_GROUPS.filter((g) => g !== truth)) : truth;
      person.selfReported = rng.pick(SELF_REPORTED[group][person.language]);
    }
    if (rng.chance(0.06)) person.tags.push(rng.pick(['scholarship', 'women-in-tech', 'career-switcher', 'university-student']));
  }

  private consent(rng: Random, person: Person) {
    const subscriber = person.type === 'subscriber';
    if (subscriber || rng.chance(0.8)) person.consents.newsletter = plus(person.firstTouchAt, rng.int(0, 3) * MINUTE);
    if (person.lead && rng.chance(0.85)) person.consents.courses = person.lead;
    if (person.completed && rng.chance(0.9)) person.consents.alumni = person.completed;
    // Website sign-ups of the last days still waiting for their confirmation click (AUD-08).
    if (subscriber && !person.importId && this.now.getTime() - person.firstTouchAt.getTime() < 3 * DAY && rng.chance(0.4)) person.pending = true;
  }

  private touch(person: Person, input: { channel: ChannelId | null; campaign: string | null; type: string; at: Date; system: string; ref: string | null; utm?: [string, string] | null }) {
    this.touchSeq += 1;
    person.touches += 1;
    this.data.touchpoints.push({
      id: demoId('touchpoint', this.touchSeq),
      contactId: person.id,
      channel: input.channel,
      campaign: input.campaign,
      type: input.type,
      occurredAt: input.at,
      sourceSystem: input.system,
      sourceRef: input.ref ?? `demo-tp-${this.touchSeq}`,
      utmSource: input.utm?.[0] ?? null,
      utmMedium: input.utm?.[1] ?? null,
      createdAt: input.at,
      updatedAt: input.at,
    });
  }

  private touches(rng: Random, person: Person, event: DemoEvent | null) {
    if (person.source === 'unattributed') {
      // Word of mouth or a tracking gap: no recorded touch, only the CRM lead (R6 "unattributed").
      return;
    }
    const first = person.firstTouchAt;
    if (event) this.register(rng, person, event, first, null);
    else if (person.channel === 'referrals') this.touch(person, { channel: 'referrals', campaign: person.campaign, type: 'referral', at: first, system: 'alumni_tracker', ref: null });
    else if (person.channel === 'chatbot') this.touch(person, { channel: 'chatbot', campaign: null, type: 'chat', at: first, system: 'chatbot', ref: null, utm: person.utm });
    else this.touch(person, { channel: person.channel, campaign: person.campaign, type: 'visit', at: first, system: 'website', ref: null, utm: person.utm });

    const end = person.applied ?? person.lead ?? this.now;
    const middle = end.getTime() - first.getTime() > 3 * DAY ? rng.int(0, person.lead ? 3 : 1) : 0;
    for (let k = 0; k < middle; k += 1) {
      const moment = between(rng, plus(first, DAY), plus(end, -HOUR));
      const kind = rng.weighted<ChannelId>([['email', person.consents.newsletter ? 3 : 0], ['organic_social', 2], ['search_website', 2.5], ['events', 1.5], ['paid_search', 1]]);
      if (kind === 'events') {
        const next = this.calendar.find((item) => item.public && item.startsAt > moment && item.startsAt < end && this.past(item.startsAt));
        if (next) this.register(rng, person, next, moment, ['instagram', 'social']);
        continue;
      }
      const campaign = kind === 'email' ? `newsletter-${dayOf(moment).slice(0, 7)}` : kind === 'paid_search' ? 'generic-courses' : null;
      const utm = kind === 'email' ? (['newsletter', 'email'] as [string, string]) : kind === 'search_website' ? null : (rng.pick(UTM[kind] as [string, string][]));
      this.touch(person, { channel: kind, campaign, type: kind === 'email' ? 'click' : 'visit', at: moment, system: kind === 'email' ? 'esp' : 'website', ref: null, utm });
    }
    if (person.lead) {
      const immediate = person.lead.getTime() - first.getTime() < HOUR;
      const channel = immediate ? person.channel : rng.chance(0.5) ? 'search_website' : person.channel;
      this.touch(person, { channel, campaign: immediate ? person.campaign : null, type: 'form', at: person.lead, system: 'website', ref: null, utm: immediate ? person.utm : null });
    }
  }

  /** People who left the list over the 18 months without a send in this data set (preferences page, old sends). */
  private buildBackgroundLeaves() {
    const rng = new Random('leaves');
    for (const person of this.people) {
      const from = plus(person.firstTouchAt, 7 * DAY);
      const to = plus(this.now, -DAY);
      if (from >= to || Object.keys(person.consents).length === 0) continue;
      const roll = rng.next();
      if (roll < 0.035) person.leave = { at: between(rng, from, to), reason: 'unsubscribed', source: rng.pick(['link', 'preferences', 'list_unsubscribe']), viaEmail: false };
      else if (roll < 0.044) person.leave = { at: between(rng, from, to), reason: 'bounced', source: 'esp_webhook', viaEmail: false };
      else if (roll < 0.046) person.leave = { at: between(rng, from, to), reason: 'complained', source: 'esp_webhook', viaEmail: false };
    }
  }

  /* ---------- Segments (AUD-13 to AUD-15) ---------- */

  private buildSegments() {
    const consent = (topic: string) => ({ kind: 'consent', topic, state: 'granted' });
    const language = (lang: Lang) => ({ kind: 'attribute', field: 'language', operator: 'in', values: [lang] });
    const defs: { key: string; name: string; description: string; rule: unknown; shared?: boolean; daysAgo: number }[] = [
      { key: 'nl-hy', name: 'Newsletter: Armenian', description: 'Armenian speakers with newsletter consent', rule: { op: 'and', conditions: [language('hy'), consent('newsletter')] }, daysAgo: 400 },
      { key: 'nl-en', name: 'Newsletter: English', description: 'English speakers with newsletter consent', rule: { op: 'and', conditions: [language('en'), consent('newsletter')] }, daysAgo: 400 },
      { key: 'nl-ru', name: 'Newsletter: Russian', description: 'Russian speakers with newsletter consent', rule: { op: 'and', conditions: [language('ru'), consent('newsletter')] }, daysAgo: 400 },
      { key: 'leads-90', name: 'New leads, last 90 days', description: 'Became a lead in the last 90 days', rule: { op: 'and', conditions: [{ kind: 'outcome', outcomeType: 'lead', operator: 'did', withinDays: 90 }] }, daysAgo: 210 },
      { key: 'applicants', name: 'Applicants not yet enrolled', description: 'In the admissions pipeline', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'type', operator: 'in', values: ['applicant'] }] }, daysAgo: 180 },
      { key: 'alumni-hired', name: 'Alumni, hired', description: 'Graduates employed according to Alumni Tracker', rule: { op: 'and', conditions: [{ kind: 'attribute', field: 'type', operator: 'in', values: ['alumnus'] }, { kind: 'attribute', field: 'employmentStatus', operator: 'in', values: ['employed'] }] }, daysAgo: 150 },
      { key: 'attendees-180', name: 'Event attendees, last 6 months', description: 'Checked in at an event in the last 180 days', rule: { op: 'and', conditions: [{ kind: 'touch', touchType: 'attendance', operator: 'did', withinDays: 180 }] }, shared: true, daysAgo: 120 },
      { key: 'hy-events', name: 'Event invitations: Armenian', description: 'Armenian speakers who agreed to event invitations', rule: { op: 'and', conditions: [language('hy'), consent('events')] }, daysAgo: 95 },
      { key: 'en-courses', name: 'Course news: English', description: 'English speakers who agreed to course news', rule: { op: 'and', conditions: [language('en'), consent('courses')] }, daysAgo: 70 },
      { key: 'ru-courses', name: 'Course news: Russian', description: 'Russian speakers who agreed to course news', rule: { op: 'and', conditions: [language('ru'), consent('courses')] }, daysAgo: 45 },
      { key: 'hy-alumni', name: 'Alumni news: Armenian', description: 'Armenian-speaking graduates with alumni consent', rule: { op: 'and', conditions: [language('hy'), { kind: 'attribute', field: 'type', operator: 'in', values: ['alumnus'] }, consent('alumni')] }, daysAgo: 30 },
    ];
    for (const def of defs) {
      const id = demoId('segment', def.key);
      this.segmentIds.set(def.key, id);
      const createdAt = at(addDays(this.today, -def.daysAgo), 11, 15);
      this.data.segments.push({ id, name: def.name, description: def.description, type: 'dynamic', rule: def.rule, ownerId: STAFF.manager, sharedWithEventHub: def.shared ?? false, createdAt, updatedAt: createdAt });
    }
  }

  /* ---------- Newsletter (NWS-01 to NWS-17) ---------- */

  private buildNewsletter() {
    const rng = new Random('newsletter');
    const templateId = demoId('template', 1);
    const cadenceId = demoId('cadence', 1);
    const created = at(this.start, 10, 0);
    this.data.newsletterTemplates.push({ id: templateId, name: 'Picsart Academy monthly', ...DEFAULT_THEME, footerNote: 'You receive this because you subscribed to Picsart Academy news.', version: 2, createdBy: STAFF.manager, createdAt: created, updatedAt: created });
    this.data.newsletterCadences.push({
      id: cadenceId, name: 'Monthly newsletter', interval: 'monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5,
      languages: ['hy', 'en', 'ru'],
      segments: { hy: this.segmentIds.get('nl-hy') as string, en: this.segmentIds.get('nl-en') as string, ru: this.segmentIds.get('nl-ru') as string },
      templateId, active: true, createdAt: created, updatedAt: created,
    });

    // The latest edition already sent: this month's if the 10th has passed, otherwise last month's.
    let edition = this.today.slice(0, 7);
    if (!this.past(at(`${edition}-10`, 11, 30))) edition = monthsBack(this.today, 1).slice(0, 7);
    const planned = at(`${edition}-10`, 11, 0);
    const periodStart = at(`${monthsBack(`${edition}-01`, 1).slice(0, 7)}-10`, 11, 0);
    const collectAt = plus(planned, -7 * DAY);
    const monthIndex = Number(edition.slice(5, 7)) - 1;

    // Items found by the collectors for this edition (NWS-02), with the ones the publish rule left out.
    const upcoming = this.calendar.filter((event) => event.startsAt > planned && event.public).slice(0, 2);
    const recent = this.calendar.filter((event) => event.startsAt < planned && event.startsAt > periodStart).slice(-1);
    const items: { key: string; system: string; ref: string; type: string; title: string; url: string | null; occurredAt: Date; publishable: boolean; skip: string | null }[] = [
      ...upcoming.map((event) => ({ key: `up-${event.n}`, system: 'event_hub', ref: event.externalId ?? event.id, type: 'upcoming_event', title: event.title, url: `${SITE}/events/${event.campaign}`, occurredAt: event.startsAt, publishable: true, skip: null })),
      ...recent.map((event) => ({ key: `re-${event.n}`, system: 'event_hub', ref: event.externalId ?? event.id, type: 'recent_event', title: event.title, url: `${SITE}/events/${event.campaign}/photos`, occurredAt: event.startsAt, publishable: true, skip: null })),
      { key: 'grad', system: 'core_engine', ref: `demo-grad-${edition}`, type: 'graduation', title: 'Frontend Development group graduated', url: null, occurredAt: plus(planned, -12 * DAY), publishable: true, skip: null },
      { key: 'hire-1', system: 'alumni_tracker', ref: `demo-hire-${edition}-1`, type: 'hire', title: 'Three Frontend graduates hired', url: `${SITE}/stories`, occurredAt: plus(planned, -9 * DAY), publishable: true, skip: null },
      { key: 'hire-2', system: 'alumni_tracker', ref: `demo-hire-${edition}-2`, type: 'hire', title: 'Graduate hired as data analyst', url: null, occurredAt: plus(planned, -15 * DAY), publishable: false, skip: 'No consent to publish the graduate’s name' },
      { key: 'group', system: 'group_launchpad', ref: `demo-group-${edition}`, type: 'new_group', title: 'New Data Analytics group opens for applications', url: `${SITE}/apply/data`, occurredAt: plus(planned, -6 * DAY), publishable: true, skip: null },
      { key: 'lib', system: 'library', ref: `demo-lib-${edition}`, type: 'library', title: 'Guide: preparing for a technical interview', url: `${SITE}/library/interview-guide`, occurredAt: plus(periodStart, -20 * DAY), publishable: false, skip: 'Published before the issue period' },
    ];
    const itemIds = new Map<string, string>();
    for (const item of items) {
      const id = demoId('collected-item', `${edition}-${item.key}`);
      itemIds.set(item.key, id);
      this.data.collectedItems.push({ id, sourceSystem: item.system, sourceRef: item.ref, type: item.type, title: item.title, url: item.url, occurredAt: item.occurredAt, payload: { titles: { en: item.title }, url: item.url }, publishable: item.publishable, skipReason: item.skip, createdAt: collectAt, updatedAt: collectAt });
    }

    const result: { lang: Lang; issueId: string; sendId: string; at: Date; subject: string; preheader: string; blocks: { id: string; title: string; body: string; buttonLabel: string | null; buttonUrl: string | null }[]; edition: string }[] = [];
    (['hy', 'en', 'ru'] as Lang[]).forEach((lang, index) => {
      const copy = NEWSLETTER[lang];
      const month = MONTHS[lang][monthIndex] as string;
      const fill = (text: string) => text.replaceAll('{month}', month);
      const issueId = demoId('issue', `${edition}-${lang}`);
      const sendId = demoId('send', `newsletter-${edition}-${lang}`);
      const event = (e: DemoEvent) => `**${e.title}**, ${e.day}. [Register](${SITE}/events/${e.campaign})`;
      const blocks = [
        { type: 'lead', title: fill(copy.lead[0]), body: fill(copy.lead[1]), items: ['grad'], buttonLabel: null, buttonUrl: null },
        { type: 'upcoming_events', title: copy.upcoming, body: upcoming.map(event).join('\n\n') || '—', items: upcoming.map((e) => `up-${e.n}`), buttonLabel: null, buttonUrl: null },
        { type: 'recent_events', title: copy.recent, body: recent.map((e) => `**${e.title}**: [photos](${SITE}/events/${e.campaign}/photos)`).join('\n\n') || '—', items: recent.map((e) => `re-${e.n}`), buttonLabel: null, buttonUrl: null },
        { type: 'hires', title: copy.hires[0], body: copy.hires[1], items: ['hire-1'], buttonLabel: null, buttonUrl: null },
        { type: 'cta', title: copy.cta[0], body: copy.cta[1], items: ['group'], buttonLabel: copy.cta[2], buttonUrl: `${SITE}/apply` },
      ];
      const approvedAt = plus(planned, -2 * DAY + index * 20 * MINUTE);
      const snapshot = blocks.map((block, position) => {
        const id = demoId('issue-block', `${edition}-${lang}-${position}`);
        this.data.issueBlocks.push({
          id, issueId, type: block.type, position, title: block.title, body: block.body,
          itemIds: block.items.map((key) => itemIds.get(key)).filter((value): value is string => Boolean(value)),
          buttonLabel: block.buttonLabel, buttonUrl: block.buttonUrl, aiDrafted: false, editedBy: position === 0 ? STAFF.editor : null,
          createdAt: collectAt, updatedAt: plus(approvedAt, -15 * MINUTE),
        });
        return { id, title: block.title, body: block.body, buttonLabel: block.buttonLabel, buttonUrl: block.buttonUrl };
      });
      const subject = fill(copy.subject);
      this.data.issues.push({
        id: issueId, cadenceId, edition, language: lang, periodStart, cutOffAt: collectAt, collectAt, plannedSendAt: planned, status: 'sent',
        subject, preheader: copy.preheader, subjectAiDrafted: false, abSamplePercent: 20, abWaitHours: 4, sendId, archiveSlug: `${edition}-${lang}`,
        createdAt: collectAt, updatedAt: planned,
      });
      // NWS-17 edit history and the review thread (NWS-10): about 25 minutes of staff time per issue (M9).
      const firstEdit = plus(approvedAt, -rng.int(18, 27) * MINUTE);
      this.data.issueEdits.push(
        { id: demoId('issue-edit', `${edition}-${lang}-1`), issueId, blockId: snapshot[0]?.id, actorId: STAFF.editor, action: 'edit', field: 'body', before: 'A busy month at the Academy.', after: snapshot[0]?.body, createdAt: firstEdit, updatedAt: firstEdit },
        { id: demoId('issue-edit', `${edition}-${lang}-2`), issueId, blockId: snapshot[3]?.id, actorId: STAFF.editor, action: 'edit', field: 'title', before: 'Hires', after: snapshot[3]?.title, createdAt: plus(firstEdit, 4 * MINUTE), updatedAt: plus(firstEdit, 4 * MINUTE) },
        { id: demoId('issue-edit', `${edition}-${lang}-3`), issueId, blockId: null, actorId: STAFF.editor, action: 'subject', field: 'subject', before: `Picsart Academy ${edition}`, after: subject, createdAt: plus(firstEdit, 9 * MINUTE), updatedAt: plus(firstEdit, 9 * MINUTE) },
      );
      this.data.issueComments.push(
        { id: demoId('issue-comment', `${edition}-${lang}-1`), issueId, actorId: STAFF.editor, kind: 'submitted', body: null, createdAt: plus(firstEdit, 12 * MINUTE), updatedAt: plus(firstEdit, 12 * MINUTE) },
        { id: demoId('issue-comment', `${edition}-${lang}-2`), issueId, actorId: STAFF.manager, kind: 'approved', body: 'Looks good, approved.', createdAt: approvedAt, updatedAt: approvedAt },
      );
      result.push({ lang, issueId, sendId, at: plus(planned, index * 15 * MINUTE), subject, preheader: copy.preheader, blocks: snapshot, edition });
    });
    return result;
  }

  /* ---------- Sends and deliveries (Flow B, EML-04, EML-10, EML-16) ---------- */

  private buildSends(newsletter: ReturnType<DemoBuilder['buildNewsletter']>) {
    const rng = new Random('sends');
    type Plan = {
      id: string; name: string; kind: 'campaign' | 'newsletter'; topic: 'newsletter' | 'courses' | 'events' | 'alumni'; purpose: 'recruitment' | 'other';
      language: Lang; segment: string; at: Date; subject: string; preheader: string; body: string; buttonLabel: string | null; buttonUrl: string | null;
      utmCampaign: string; issueId: string | null; blocks: { id: string; title: string; body: string; buttonLabel: string | null; buttonUrl: string | null }[] | null;
      rates: { open: number; click: number; unsub: number; hard: number; soft: number; complaint: number }; draft?: boolean; legacy?: boolean;
    };
    const campaign = (key: string, daysAgo: number, rest: Omit<Plan, 'id' | 'at' | 'kind' | 'issueId' | 'blocks' | 'utmCampaign'>): Plan => ({
      ...rest, id: demoId('send', key), kind: 'campaign', at: at(addDays(this.today, -daysAgo), 11, 0), issueId: null, blocks: null, utmCampaign: key,
    });
    const plans: Plan[] = [
      campaign('open-day-invitation-hy', 78, {
        name: 'Open day invitation', topic: 'events', purpose: 'other', language: 'hy', segment: 'hy-events',
        subject: 'Հրավեր բաց դռների օրվան', preheader: 'Ծանոթացեք մենթորներին և դասընթացներին', body: 'Բարև {{first_name}},\n\nՀրավիրում ենք **բաց դռների օրվան**։ [Ծրագիր](https://academy.example.test/events)',
        buttonLabel: 'Գրանցվել', buttonUrl: `${SITE}/events/open-day`, rates: { open: 0.46, click: 0.11, unsub: 0.004, hard: 0.006, soft: 0.01, complaint: 0.0004 },
      }),
      campaign('autumn-intake-last-seats-en', 52, {
        name: 'Autumn intake: last seats', topic: 'courses', purpose: 'recruitment', language: 'en', segment: 'en-courses',
        subject: 'Last seats in the autumn groups', preheader: 'Applications close in two weeks', body: 'Hi {{first_name}},\n\nThe autumn groups are almost full. [See the courses](https://academy.example.test/courses)',
        buttonLabel: 'Apply now', buttonUrl: `${SITE}/apply`, rates: { open: 0.39, click: 0.07, unsub: 0.006, hard: 0.008, soft: 0.012, complaint: 0.0008 }, legacy: true,
      }),
      campaign('data-analytics-launch-ru', 33, {
        name: 'Data Analytics course launch', topic: 'courses', purpose: 'recruitment', language: 'ru', segment: 'ru-courses',
        subject: 'Новый курс Data Analytics', preheader: 'Старт группы в следующем месяце', body: 'Здравствуйте, {{first_name}}!\n\nОткрываем набор на **Data Analytics**. [Программа курса](https://academy.example.test/courses/data)',
        buttonLabel: 'Подать заявку', buttonUrl: `${SITE}/apply/data`, rates: { open: 0.43, click: 0.085, unsub: 0.005, hard: 0.005, soft: 0.009, complaint: 0.0005 },
      }),
      campaign('alumni-meetup-hy', 19, {
        name: 'Alumni meetup invitation', topic: 'alumni', purpose: 'other', language: 'hy', segment: 'hy-alumni',
        subject: 'Շրջանավարտների հանդիպում', preheader: 'Կարիերայի մասին զրույց', body: 'Բարև {{first_name}},\n\nՍպասում ենք ձեզ շրջանավարտների հանդիպմանը։ [Մանրամասներ](https://academy.example.test/alumni)',
        buttonLabel: 'Մասնակցել', buttonUrl: `${SITE}/alumni/meetup`, rates: { open: 0.52, click: 0.14, unsub: 0.002, hard: 0.003, soft: 0.006, complaint: 0 },
      }),
      ...newsletter.map((issue): Plan => ({
        id: issue.sendId, name: `Newsletter ${issue.edition} (${issue.lang})`, kind: 'newsletter', topic: 'newsletter', purpose: 'other', language: issue.lang,
        segment: `nl-${issue.lang}`, at: issue.at, subject: issue.subject, preheader: issue.preheader, body: '', buttonLabel: null, buttonUrl: null,
        utmCampaign: `newsletter-${issue.edition}`, issueId: issue.issueId, blocks: issue.blocks,
        rates: { open: 0.41, click: 0.072, unsub: 0.003, hard: 0.004, soft: 0.008, complaint: 0.0003 },
      })),
    ];
    plans.sort((a, b) => a.at.getTime() - b.at.getTime());
    plans.push({
      ...campaign('winter-workshops-en', -9, {
        name: 'Winter workshops announcement', topic: 'events', purpose: 'other', language: 'en', segment: 'attendees-180',
        subject: 'Winter workshops are open for registration', preheader: 'Four evenings, four skills', body: 'Hi {{first_name}},\n\nJoin our winter workshops. [Programme](https://academy.example.test/workshops)',
        buttonLabel: 'Register', buttonUrl: `${SITE}/workshops`, rates: { open: 0, click: 0, unsub: 0, hard: 0, soft: 0, complaint: 0 },
      }),
      draft: true,
    });

    let sendIndex = 0;
    for (const plan of plans) {
      sendIndex += 1;
      const created = plus(plan.draft ? this.now : plan.at, -(plan.draft ? 2 : 3) * DAY);
      const base = {
        id: plan.id, name: plan.name, kind: plan.kind, topic: plan.topic, purpose: plan.purpose, includeActiveAdmissions: plan.kind === 'newsletter',
        segmentId: this.segmentIds.get(plan.segment) ?? null, language: plan.language, fromName: 'Picsart Academy', fromAddress: 'news', subject: plan.subject,
        preheader: plan.preheader, body: plan.body, buttonLabel: plan.buttonLabel, buttonUrl: plan.buttonUrl, utmCampaign: plan.utmCampaign, issueId: plan.issueId,
        blocks: plan.blocks?.map((block) => ({ ...block, imageUrl: null, imageAlt: null })) ?? null,
        theme: plan.blocks ? { ...DEFAULT_THEME, footerNote: 'You receive this because you subscribed to Picsart Academy news.' } : null,
        createdBy: STAFF.editor, createdAt: created,
      };
      if (plan.draft) {
        this.data.sends.push({ ...base, status: 'draft', updatedAt: created });
        continue;
      }
      const recipients = this.people.filter((person) => this.eligible(person, plan.topic, plan.language, plan.at, plan.purpose === 'recruitment'));
      let last = plan.at;
      let sent = 0;
      recipients.forEach((person, i) => {
        const deliveryId = demoId('delivery', `${sendIndex}-${person.n}`);
        const sentAt = plus(plan.at, Math.round((i * 1000) / 14));
        last = sentAt;
        const legacy = plan.legacy && person.importId === this.importLegacy.id;
        const roll = rng.next();
        const hard = legacy ? 0.15 : plan.rates.hard;
        const status = roll < plan.rates.complaint ? 'complained' : roll < plan.rates.complaint + hard ? 'bounced_hard' : roll < plan.rates.complaint + hard + plan.rates.soft ? 'bounced_soft' : 'delivered';
        const reached = status === 'delivered' || status === 'complained';
        const deliveredAt = reached ? plus(sentAt, rng.int(2, 25) * 1000) : null;
        const openedAt = reached && rng.chance(plan.rates.open) ? plus(sentAt, rng.int(4, 2 * 24 * 60) * MINUTE) : null;
        const clicked = reached && this.past(plus(sentAt, HOUR)) && rng.chance(plan.rates.click / Math.max(plan.rates.open, 0.01) * (openedAt ? 1 : 0.15));
        const firstClickAt = clicked ? plus(openedAt ?? sentAt, rng.int(1, 90) * MINUTE) : null;
        const unsubscribedAt = status === 'delivered' && rng.chance(plan.rates.unsub) ? plus(openedAt ?? sentAt, rng.int(1, 120) * MINUTE) : null;
        sent += 1;
        this.data.deliveries.push({
          id: deliveryId, sendId: plan.id, contactId: person.id, email: person.email, status, variant: null, attempts: 1,
          espMessageId: `demo-msg-${sendIndex}-${person.n}`, sentAt, deliveredAt, openedAt, firstClickAt, unsubscribedAt,
          lastError: status === 'bounced_hard' ? '550 5.1.1 mailbox does not exist' : status === 'bounced_soft' ? '452 4.2.2 mailbox full' : null,
          createdAt: plus(plan.at, -MINUTE), updatedAt: latest(sentAt, deliveredAt, openedAt, firstClickAt, unsubscribedAt),
        });
        if (firstClickAt) {
          const links: (readonly [string, string | null])[] = plan.blocks
            ? plan.blocks.flatMap((block) => [...[...block.body.matchAll(/\((https:\/\/[^)]+)\)/g)].map((m) => [m[1] as string, block.id] as const), ...(block.buttonUrl ? [[block.buttonUrl, block.id] as const] : [])])
            : [...[...plan.body.matchAll(/\((https:\/\/[^)]+)\)/g)].map((m) => [m[1] as string, null] as const), ...(plan.buttonUrl ? [[plan.buttonUrl, null] as const] : [])];
          const clicks = rng.int(1, 2);
          for (let k = 0; k < clicks && links.length > 0; k += 1) {
            const [url, blockId] = rng.pick(links);
            const occurredAt = plus(firstClickAt, k * rng.int(1, 30) * MINUTE);
            this.data.linkClicks.push({ id: demoId('link-click', `${sendIndex}-${person.n}-${k}`), deliveryId, sendId: plan.id, contactId: person.id, url, blockId, occurredAt, createdAt: occurredAt, updatedAt: occurredAt });
          }
          this.touch(person, { channel: 'email', campaign: plan.utmCampaign, type: 'click', at: firstClickAt, system: 'esp', ref: deliveryId, utm: ['newsletter', 'email'] });
        }
        const leave = (input: Leave) => {
          if (!person.leave || person.leave.at > input.at) person.leave = input;
        };
        if (unsubscribedAt) leave({ at: unsubscribedAt, reason: 'unsubscribed', source: rng.chance(0.7) ? 'link' : 'list_unsubscribe', viaEmail: true });
        if (status === 'bounced_hard') leave({ at: deliveredAt ?? plus(sentAt, 30_000), reason: 'bounced', source: 'esp_webhook', viaEmail: true });
        if (status === 'complained') leave({ at: plus(sentAt, rng.int(1, 30) * HOUR), reason: 'complained', source: 'esp_webhook', viaEmail: true });
      });
      if (plan.legacy) for (const person of this.people) if (person.importId === this.importLegacy.id) person.blockedAt = plus(last, HOUR);
      const approvedAt = plus(plan.at, -(plan.kind === 'newsletter' ? 2 * DAY : 22 * HOUR));
      this.data.sends.push({
        ...base, status: 'sent', scheduledAt: plan.at, approvedBy: STAFF.manager, approvedAt, startedAt: plan.at, finishedAt: plus(last, 1000), sentCount: sent,
        updatedAt: plus(last, 1000),
      });
    }
    const legacy = this.data.contactImports.find((row) => row.id === this.importLegacy.id);
    const blocked = this.people.find((person) => person.blockedAt)?.blockedAt ?? null;
    if (legacy && blocked) Object.assign(legacy, { sendBlockedAt: blocked, updatedAt: blocked });
  }

  /** Who a send reaches at that moment: same rules as the dispatcher (consent, suppression, AUD-17). */
  private eligible(person: Person, topic: keyof Person['consents'], language: Lang, moment: Date, recruitment: boolean) {
    if (person.language !== language || person.pending) return false;
    if (person.firstTouchAt.getTime() > moment.getTime() - DAY) return false;
    if (person.leave && person.leave.at <= moment) return false;
    if (person.blockedAt && person.blockedAt <= moment) return false;
    const granted = person.consents[topic];
    if (!granted || granted > moment) return false;
    if (recruitment && person.applied && person.applied <= moment && !(person.enrolled && person.enrolled <= moment) && person.crmStage && ACTIVE_ADMISSION_STAGES.includes(person.crmStage)) return false;
    return true;
  }

  /* ---------- Contact rows, consent records, suppressions, outcomes ---------- */

  private finishPeople() {
    const rng = new Random('records');
    let consentSeq = 0;
    const consentRow = (person: Person, topic: string, state: string, moment: Date, method: string, extra: Partial<Row<typeof schema.consentRecords>> = {}) => {
      consentSeq += 1;
      this.data.consentRecords.push({
        id: demoId('consent', consentSeq), contactId: person.id, topic, state, method,
        wordingVersion: method === 'link' ? null : `${topic}-${person.language}-v1`,
        sourceUrl: method === 'form' ? `${SITE}/${topic === 'newsletter' ? 'subscribe' : 'apply'}` : null,
        ip: method === 'form' ? `198.51.100.${(person.n % 250) + 1}` : null,
        createdAt: moment, updatedAt: moment, ...extra,
      });
    };
    for (const person of this.people) {
      const method = person.importId ? 'import' : person.source === 'events' ? 'event' : 'form';
      for (const [topic, moment] of Object.entries(person.consents) as [string, Date][]) {
        if (topic === 'newsletter' && person.pending) {
          consentRow(person, topic, 'pending', moment, 'form');
          continue;
        }
        const own = topic === 'events' ? 'event' : topic === 'newsletter' ? method : 'form';
        if (topic === 'newsletter' && !person.importId && rng.chance(0.02)) {
          consentRow(person, topic, 'granted', moment, 'manual', { actorId: STAFF.editor, reason: 'Signed up on paper at the reception desk', wordingVersion: `newsletter-${person.language}-v1` });
        } else consentRow(person, topic, 'granted', moment, own);
      }
      const leave = person.leave;
      if (leave?.reason === 'unsubscribed') {
        for (const topic of Object.keys(person.consents)) consentRow(person, topic, 'withdrawn', leave.at, 'link');
      }
      if (leave) {
        this.data.suppressions.push({
          id: demoId('suppression', person.n), emailHash: hashEmail(person.email),
          reason: leave.reason === 'unsubscribed' ? 'unsubscribed' : leave.reason === 'bounced' ? 'hard_bounce' : 'complaint',
          source: leave.source, createdAt: leave.at, updatedAt: leave.at,
        });
      }

      const crmLeadId = person.lead ? `demo-crm-${String(person.n).padStart(5, '0')}` : null;
      const corePersonId = person.enrolled ? `demo-core-${String(person.n).padStart(5, '0')}` : null;
      const group = person.enrolled ? `${person.course.prefix}-${dayOf(person.enrolled).slice(0, 7)}` : null;
      const outcome = (type: string, moment: Date | null, system: string, ref: string) => {
        if (!moment) return;
        this.data.outcomes.push({ id: demoId('outcome', `${person.n}-${type}`), contactId: person.id, corePersonId, type, occurredAt: moment, courseId: person.course.id, groupId: type === 'lead' || type === 'applied' ? null : group, sourceSystem: system, sourceRef: ref, createdAt: moment, updatedAt: moment });
      };
      if (crmLeadId) {
        outcome('lead', person.lead, 'navigator_crm', crmLeadId);
        outcome('applied', person.applied, 'navigator_crm', crmLeadId);
      }
      if (corePersonId) {
        outcome('enrolled', person.enrolled, 'core_engine', `demo-core-o-${person.n}-enrolled`);
        outcome('completed', person.completed, 'core_engine', `demo-core-o-${person.n}-completed`);
        if (person.hired) outcome('hired', person.hired, 'alumni_tracker', `${corePersonId}:${dayOf(person.hired)}`);
      }

      const status = leave ? (leave.reason === 'unsubscribed' ? 'unsubscribed' : leave.reason) : 'active';
      const updatedAt = leave?.viaEmail && leave.reason === 'unsubscribed' ? plus(leave.at, 300) : latest(person.createdAt, person.lead, person.applied, person.enrolled, person.completed, person.hired, leave?.at);
      this.data.contacts.push({
        id: person.id, corePersonId, email: person.email, emailKey: emailKey(person.email), importId: person.importId, crmLeadId, crmStage: person.crmStage,
        selfReportedSource: person.selfReported, employmentStatus: person.employment, phone: person.phone, firstName: person.firstName, lastName: person.lastName,
        language: person.language, type: person.type, sourceChannel: person.channel, sourceCampaign: person.campaign, firstTouchAt: person.firstTouchAt,
        tags: person.tags, status, frequency: person.frequency, createdAt: person.createdAt, updatedAt,
      });
    }
  }

  private buildEventRows() {
    const rng = new Random('event-rows');
    for (const event of this.calendar) {
      const createdAt = plus(event.startsAt, -rng.int(25, 45) * DAY);
      const happened = this.past(event.startsAt);
      const media = happened && (event.type === 'workshop' || event.type === 'open_day');
      this.data.events.push({
        id: event.id, externalId: event.externalId, title: event.title, type: event.type, language: event.language, startsAt: event.startsAt, public: event.public,
        registrationUrl: event.public ? `${SITE}/events/${event.campaign}` : null, registrationOpen: !happened,
        recordingUrl: media && event.type === 'workshop' ? `${SITE}/media/${event.campaign}/recording` : null,
        photosUrl: media ? `${SITE}/media/${event.campaign}/photos` : null, mediaPublic: media,
        createdAt: createdAt < this.now ? createdAt : plus(this.now, -DAY), updatedAt: happened ? event.startsAt : createdAt < this.now ? createdAt : plus(this.now, -DAY),
      });
    }
    this.data.eventRegistrations.push(...this.registrations);
    // A static list (AUD-15): the guests of the latest open day.
    const openDay = [...this.calendar].reverse().find((event) => event.type === 'open_day' && this.past(event.startsAt));
    if (openDay) {
      const id = demoId('segment', 'open-day-guests');
      const createdAt = plus(openDay.startsAt, 2 * DAY);
      const members = this.registrations.filter((row) => row.eventId === openDay.id && row.checkedInAt);
      this.data.segments.push({ id, name: `Guests: ${openDay.title} (${openDay.day})`, description: 'Checked in at the open day; for the follow-up email', type: 'static', rule: null, ownerId: STAFF.editor, lastCount: members.length, lastCountedAt: createdAt, createdAt, updatedAt: createdAt });
      for (const row of members) this.data.segmentMembers.push({ segmentId: id, contactId: row.contactId, addedBy: STAFF.editor, createdAt, updatedAt: createdAt });
    }
  }

  /* ---------- Costs: ad spend, manual costs, event costs, rates (9.1, ANL-05) ---------- */

  private metaCampaigns(day: string): AdCampaign[] {
    const year = day.slice(0, 4);
    const md = day.slice(5);
    const list: AdCampaign[] = [{ platform: 'meta_ads', id: 'meta-always-on-retargeting', name: 'Always-on retargeting', utm: 'always-on-retargeting', currency: 'USD', spend: [3, 9], weight: 1 }];
    if (md >= '01-20' && md <= '04-30') list.push({ platform: 'meta_ads', id: `meta-spring-intake-${year}`, name: `Spring intake ${year}`, utm: `spring-intake-${year}`, currency: 'USD', spend: [12, 35], weight: 4 });
    if (md >= '05-15' && md <= '07-31') list.push({ platform: 'meta_ads', id: `meta-summer-bootcamp-${year}`, name: `Summer bootcamp ${year}`, utm: `summer-bootcamp-${year}`, currency: 'USD', spend: [8, 22], weight: 3 });
    if (md >= '08-10' && md <= '11-20') list.push({ platform: 'meta_ads', id: `meta-autumn-intake-${year}`, name: `Autumn intake ${year}`, utm: `autumn-intake-${year}`, currency: 'USD', spend: [15, 42], weight: 4 });
    const soon = this.calendar.some((event) => (event.type === 'open_day' || event.type === 'info_session') && daysBetween(day, event.day) >= 1 && daysBetween(day, event.day) <= 7);
    if (soon) list.push({ platform: 'meta_ads', id: 'meta-open-day-reminders', name: 'Open day reminders', utm: 'open-day-reminders', currency: 'USD', spend: [5, 15], weight: 2 });
    return list;
  }

  private searchCampaigns(day: string): AdCampaign[] {
    const season = SEASON[Number(day.slice(5, 7)) - 1] as number;
    return [
      { platform: 'google_ads', id: 'gads-brand-search', name: 'Brand search', utm: 'brand-search', currency: 'AMD', spend: [2_000, 7_500], weight: 1 },
      { platform: 'google_ads', id: 'gads-generic-courses', name: 'Generic courses', utm: 'generic-courses', currency: 'AMD', spend: [Math.round(3_000 * season), Math.round(10_000 * season)], weight: 1 },
    ];
  }

  private buildCosts() {
    const rng = new Random('costs');
    const yesterday = addDays(this.today, -1);
    // Meta Ads has failed for the last two nights (see buildOperations): its rows stop three days ago.
    const metaUntil = addDays(this.today, -3);
    const csvUntil = addDays(this.start, 59);
    for (let day = this.start; day <= yesterday; day = addDays(day, 1)) {
      for (const campaign of [...(day <= metaUntil ? this.metaCampaigns(day) : []), ...this.searchCampaigns(day)]) {
        const amount = campaign.currency === 'USD' ? rng.int(campaign.spend[0] * 100, campaign.spend[1] * 100) / 100 : rng.int(campaign.spend[0], campaign.spend[1]);
        const rate = demoRate(campaign.currency, day);
        const clicks = Math.max(1, Math.round((campaign.currency === 'USD' ? amount * 2.4 : amount / 160) * (0.7 + rng.next() * 0.6)));
        this.data.adSpendDaily.push({
          id: demoId('ad-spend', `${campaign.id}-${day}`), date: day, platform: campaign.platform, platformCampaignId: campaign.id, campaignName: campaign.name,
          campaign: campaign.utm, channel: campaign.platform === 'meta_ads' ? 'paid_social' : 'paid_search', amountAmd: Math.round(amount * rate),
          originalAmount: amount.toFixed(2), currency: campaign.currency, rateToAmd: String(rate), impressions: clicks * rng.int(25, 70), clicks,
          leads: rng.int(0, Math.max(1, Math.round(clicks / 40))),
          // The first two months came from CSV exports before the ad accounts were connected (9.1 fallback).
          origin: campaign.platform === 'google_ads' && day <= csvUntil ? 'csv' : 'api',
          createdAt: at(addDays(day, 1), 3, 5), updatedAt: at(addDays(day, 1), 3, 5),
        });
      }
    }

    let costSeq = 0;
    const cost = (input: { channel: ChannelId; campaign?: string | null; description: string; from: string; to: string; amount: number; currency: 'AMD' | 'USD' | 'EUR'; by?: string; externalRef?: string | null; deleted?: boolean }) => {
      costSeq += 1;
      const rate = demoRate(input.currency, input.from);
      const entered = at(input.from < this.today ? addDays(input.from, 1) : addDays(this.today, -1), 10, 30);
      const createdAt = entered < this.now ? entered : plus(this.now, -HOUR);
      const by = input.by ?? STAFF.editor;
      this.data.manualCosts.push({
        id: demoId('manual-cost', costSeq), channel: input.channel, campaign: input.campaign ?? null, description: input.description, dateFrom: input.from, dateTo: input.to,
        amountAmd: Math.round(input.amount * rate), originalAmount: input.amount.toFixed(2), currency: input.currency, rateToAmd: String(rate),
        createdBy: by, updatedBy: by, externalRef: input.externalRef ?? null,
        deletedAt: input.deleted ? plus(createdAt, 2 * DAY) : null, deletedBy: input.deleted ? STAFF.manager : null,
        createdAt, updatedAt: input.deleted ? plus(createdAt, 2 * DAY) : createdAt,
      });
    };
    for (let back = DEMO_MONTHS - 1; back >= 0; back -= 1) {
      const from = monthsBack(this.today, back);
      const to = monthEnd(from);
      const label = from.slice(0, 7);
      cost({ channel: 'paid_social', description: `Social media agency fee, ${label}`, from, to, amount: 250_000, currency: 'AMD', by: STAFF.manager });
      cost({ channel: 'organic_social', campaign: 'instagram-reels', description: `Content creators (Reels), ${label}`, from, to, amount: rng.int(300, 600), currency: 'USD' });
      cost({ channel: 'search_website', description: `SEO and website maintenance, ${label}`, from, to, amount: 180_000, currency: 'AMD' });
      cost({ channel: 'email', description: `Email service subscription, ${label}`, from, to, amount: 89, currency: 'USD' });
      cost({ channel: 'chatbot', description: `Chatbot platform subscription, ${label}`, from, to, amount: 49, currency: 'USD' });
      cost({ channel: 'referrals', campaign: 'alumni-referral', description: `Alumni referral bonuses, ${label}`, from, to, amount: rng.int(2, 6) * 50_000, currency: 'AMD', by: STAFF.manager });
      if (Number(from.slice(5, 7)) % 3 === 1) cost({ channel: 'partners_press', campaign: 'tech-press', description: `Tech media partnership, Q${Math.ceil(Number(from.slice(5, 7)) / 3)} ${from.slice(0, 4)}`, from, to: monthEnd(monthsBack(from, -2)), amount: 900, currency: 'EUR', by: STAFF.manager });
    }
    const fair = dayOf(this.importFair.at);
    cost({ channel: 'partners_press', campaign: 'university-career-fair', description: 'University career fair: booth and printed materials', from: fair, to: fair, amount: 350_000, currency: 'AMD' });
    cost({ channel: 'paid_social', description: 'Duplicate of the agency fee (entered twice)', from: monthsBack(this.today, 2), to: monthEnd(monthsBack(this.today, 2)), amount: 250_000, currency: 'AMD', deleted: true });
    for (const event of this.calendar) {
      const amount = event.type === 'open_day' ? rng.int(30, 60) * 10_000 : event.type === 'graduation' ? rng.int(50, 90) * 10_000 : rng.int(8, 25) * 10_000;
      cost({
        channel: 'events', campaign: event.campaign, description: `Venue, catering and print: ${event.title}`, from: event.day, to: event.day, amount, currency: 'AMD',
        by: event.externalId ? 'event-hub' : STAFF.editor, externalRef: event.externalId ? `event_hub:demo-cost-${event.n}` : null,
      });
    }

    // CBA rates on the first day of each month (9.2), for the Costs page; the costs above carry their own day's rate.
    const rates: { date: string; currency: string; rateToAmd: number }[] = [];
    for (let back = DEMO_MONTHS - 1; back >= 0; back -= 1) {
      const date = monthsBack(this.today, back);
      for (const currency of ['USD', 'EUR', 'RUB', 'GBP']) rates.push({ date, currency, rateToAmd: demoRate(currency, date) });
    }
    for (const currency of ['USD', 'EUR', 'RUB', 'GBP']) rates.push({ date: this.today, currency, rateToAmd: demoRate(currency, this.today) });
    this.data.appSettings.push({ key: 'exchange_rates', value: { source: 'demo', note: 'Synthetic Central Bank of Armenia rates (demo data set)', rates }, updatedBy: 'demo-seed' });
  }

  /* ---------- Website and social daily metrics (9.1) ---------- */

  private buildChannelData() {
    const rng = new Random('channel-data');
    const yesterday = addDays(this.today, -1);
    for (let day = this.start, i = 0; day <= yesterday; day = addDays(day, 1), i += 1) {
      const season = SEASON[Number(day.slice(5, 7)) - 1] as number;
      const growth = 1 + i / 900;
      const seasonal = this.metaCampaigns(day).find((campaign) => campaign.weight >= 3)?.utm ?? 'always-on-retargeting';
      const dims: [string, string, string, string, number][] = [
        ['instagram', 'paid_social', seasonal, '/courses', 70],
        ['instagram', 'social', '', '/', 45],
        ['facebook', 'social', '', '/events', 20],
        ['google', 'organic', '', '/courses', 90],
        ['google', 'cpc', 'brand-search', '/', 35],
        ['newsletter', 'email', `newsletter-${day.slice(0, 7)}`, '/events', 15],
        ['', '', '', '/', 60],
        ['tiktok', 'influencer', 'creator-test', '/courses/design', 8],
      ];
      for (const [source, medium, campaign, landingPage, base] of dims) {
        const sessions = Math.max(1, Math.round(base * season * growth * (0.6 + rng.next() * 0.8)));
        const mapped = source === 'tiktok' ? null : channelFromUtm(source || null, medium || null);
        this.data.webTrafficDaily.push({
          id: demoId('web', `${day}-${source}-${medium}-${landingPage}`), date: day, utmSource: source, utmMedium: medium, utmCampaign: campaign, landingPage, channel: mapped,
          sessions, conversions: rng.int(0, Math.max(1, Math.round(sessions / 25))), createdAt: at(addDays(day, 1), 3, 2), updatedAt: at(addDays(day, 1), 3, 2),
        });
      }
      for (const [platform, followers] of [['instagram', 14_200], ['facebook', 9_800]] as const) {
        this.data.socialDaily.push({
          id: demoId('social', `${platform}-${day}`), date: day, platform, accountId: `${platform}-academy`,
          reach: Math.round(rng.int(800, 6000) * season), engagement: Math.round(rng.int(40, 600) * season), followers: followers + Math.round(i * (platform === 'instagram' ? 6.5 : 2.1)),
          leadForms: rng.int(0, 4), createdAt: at(addDays(day, 1), 3, 3), updatedAt: at(addDays(day, 1), 3, 3),
        });
      }
    }
  }

  /* ---------- Channel taxonomy review queue and tracked links (ANL-03, ANL-04) ---------- */

  private buildTaxonomy() {
    const touches = this.data.touchpoints;
    const seen = (source: string, medium: string) => {
      const rows = touches.filter((row) => row.utmSource === source && row.utmMedium === medium);
      const times = rows.map((row) => row.occurredAt as Date).sort((a, b) => a.getTime() - b.getTime());
      return { count: rows.length, first: times[0] ?? plus(this.now, -30 * DAY), last: times[times.length - 1] ?? plus(this.now, -2 * DAY) };
    };
    let n = 0;
    const add = (source: string, field: 'utm' | 'crm_label', value: string, stats: { count: number; first: Date; last: Date }, resolved?: ChannelId) => {
      n += 1;
      const resolvedAt = resolved ? plus(stats.last, 3 * HOUR) : null;
      this.data.unmappedValues.push({
        id: demoId('unmapped', n), source, field, value, firstSeenAt: stats.first, lastSeenAt: stats.last, count: Math.max(1, stats.count),
        resolvedChannelId: resolved ?? null, resolvedBy: resolved ? STAFF.manager : null, resolvedAt,
        createdAt: stats.first, updatedAt: resolvedAt ?? stats.last,
      });
    };
    const tiktok = seen('tiktok', 'influencer');
    const webDays = this.data.webTrafficDaily.filter((row) => row.utmSource === 'tiktok').length;
    add('website_analytics', 'utm', 'tiktok / influencer', { ...tiktok, count: tiktok.count + webDays, first: at(this.start, 3, 2) });
    add('website', 'utm', 'telegram / channel', seen('telegram', 'channel'));
    add('website', 'utm', 'fb / story', seen('fb', 'story'));
    add('website', 'utm', 'linkedin / inmail', seen('linkedin', 'inmail'), 'organic_social');
    add('navigator_crm', 'crm_label', 'job fair', { count: 7, first: plus(this.now, -40 * DAY), last: plus(this.now, -4 * DAY) });
    add('navigator_crm', 'crm_label', 'friend at work', { count: 4, first: plus(this.now, -25 * DAY), last: plus(this.now, -1 * DAY) });
    const ruleAt = plus(seen('linkedin', 'inmail').last, 3 * HOUR);
    this.data.channelRules.push({ id: demoId('channel-rule', 1), kind: 'source_medium', value: 'linkedin/inmail', channel: 'organic_social', createdBy: STAFF.manager, createdAt: ruleAt, updatedAt: ruleAt });

    const rng = new Random('links');
    const links: [string, ChannelId, string, string, string, string | null][] = [
      ['Autumn intake: Instagram story', 'paid_social', 'instagram', `autumn-intake-${this.today.slice(0, 4)}`, '/courses', 'story'],
      ['Open day: Facebook event', 'organic_social', 'facebook', 'open-day', '/events', null],
      ['Newsletter: apply button', 'email', 'newsletter', 'newsletter', '/apply', 'cta'],
      ['University partners page', 'partners_press', 'partner-site', 'university-partners', '/partners', null],
      ['Alumni referral link', 'referrals', 'alumni', 'alumni-referral', '/apply', null],
      ['Chatbot: course list', 'chatbot', 'chatbot', 'chatbot-courses', '/courses', null],
    ];
    const medium: Record<ChannelId, string> = { paid_social: 'paid_social', organic_social: 'social', search_website: 'organic', paid_search: 'cpc', email: 'email', events: 'offline', referrals: 'referral', chatbot: 'chat', partners_press: 'partner' };
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    links.forEach(([label, channel, source, campaign, path, content], i) => {
      const destination = `${SITE}${path}`;
      const full = new URL(destination);
      full.searchParams.set('utm_source', source);
      full.searchParams.set('utm_medium', medium[channel]);
      full.searchParams.set('utm_campaign', slug(campaign));
      if (content) full.searchParams.set('utm_content', content);
      const createdAt = plus(this.now, -rng.int(10, 120) * DAY);
      const clicks = rng.int(12, 480);
      this.data.trackedLinks.push({
        id: demoId('tracked-link', i + 1), code: Array.from({ length: 7 }, () => rng.pick([...alphabet])).join(''), label, destinationUrl: destination, fullUrl: full.toString(),
        channel, utmSource: source, utmMedium: medium[channel], utmCampaign: slug(campaign), utmContent: content, clicks, lastClickAt: plus(this.now, -rng.int(1, 72) * HOUR),
        createdBy: STAFF.editor, createdAt, updatedAt: createdAt,
      });
    });
  }

  /* ---------- Sending domain and DMARC reports (EML-02, EML-07, EML-08) ---------- */

  private buildEmailSetup() {
    const rng = new Random('email-setup');
    const identity = { provider: 'log', placeholder: true, spfInclude: 'spf.esp-not-chosen.invalid', dkim: [{ selector: 'mh1', type: 'CNAME' as const, value: 'mh1.dkim.esp-not-chosen.invalid' }], trackingLabel: 'click', trackingTarget: 'track.esp-not-chosen.invalid' };
    const verifiedAt = plus(this.now, -70 * DAY);
    const checkedAt = plus(this.now, -35 * MINUTE);
    const domain = 'news.academy-domain.invalid';
    const records = [
      { kind: 'spf' as const, host: domain, status: 'verified' as const, found: ['v=spf1 include:spf.esp-not-chosen.invalid ~all'], problems: [] },
      { kind: 'dkim' as const, host: `mh1._domainkey.${domain}`, status: 'verified' as const, found: ['mh1.dkim.esp-not-chosen.invalid'], problems: [] },
      { kind: 'dmarc' as const, host: `_dmarc.${domain}`, status: 'verified' as const, found: [`v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${domain}`], problems: [] },
      { kind: 'tracking' as const, host: `click.${domain}`, status: 'verified' as const, found: ['track.esp-not-chosen.invalid'], problems: [] },
    ];
    this.data.sendingDomains.push(
      {
        id: demoId('domain', 1), domain, espIdentity: identity, spfStatus: 'verified', dkimStatus: 'verified', dmarcStatus: 'verified', trackingStatus: 'verified',
        dmarcPolicy: 'quarantine', lastCheck: { checkedAt: checkedAt.toISOString(), records, dmarcPolicy: 'quarantine' }, lastCheckedAt: checkedAt, verifiedAt,
        warmupDays: 21, warmupStartedAt: verifiedAt, createdAt: plus(verifiedAt, -3 * DAY), updatedAt: checkedAt,
      },
      {
        id: demoId('domain', 2), domain: 'events.academy-domain.invalid', espIdentity: identity, spfStatus: 'verified', dkimStatus: 'missing', dmarcStatus: 'invalid', trackingStatus: 'pending',
        dmarcPolicy: 'none', lastCheckedAt: plus(this.now, -2 * DAY), warmupDays: 21, createdAt: plus(this.now, -6 * DAY), updatedAt: plus(this.now, -2 * DAY),
        lastCheck: {
          checkedAt: plus(this.now, -2 * DAY).toISOString(), dmarcPolicy: 'none',
          records: [
            { kind: 'spf', host: 'events.academy-domain.invalid', status: 'verified', found: ['v=spf1 include:spf.esp-not-chosen.invalid ~all'], problems: [] },
            { kind: 'dkim', host: 'mh1._domainkey.events.academy-domain.invalid', status: 'missing', found: [], problems: ['No DKIM record at this host yet'] },
            { kind: 'dmarc', host: '_dmarc.events.academy-domain.invalid', status: 'invalid', found: ['v=DMARC1; p=none'], problems: ['Policy is none: use quarantine or reject before sending'] },
          ],
        },
      },
    );
    const orgs = ['mail-provider-a.example', 'mail-provider-b.example', 'mail-provider-c.example'];
    for (let k = 0; k < 6; k += 1) {
      const end = plus(this.now, -(k * 5 + 1) * DAY);
      const begin = plus(end, -DAY);
      const id = demoId('dmarc-report', k + 1);
      const org = orgs[k % orgs.length] as string;
      this.data.dmarcReports.push({ id, orgName: org, reportId: `demo-${org}-${dayOf(end)}`, domain, policy: 'quarantine', dateBegin: begin, dateEnd: end, uploadedBy: STAFF.admin, createdAt: plus(end, 6 * HOUR), updatedAt: plus(end, 6 * HOUR) });
      const rows = [
        { sourceIp: '192.0.2.10', count: rng.int(300, 900), disposition: 'none', dkim: 'pass', spf: 'pass', category: 'pass' },
        { sourceIp: '198.51.100.23', count: rng.int(1, 4), disposition: 'quarantine', dkim: 'fail', spf: 'fail', category: 'fail' },
        ...(k === 0 ? [{ sourceIp: '203.0.113.77', count: 3, disposition: 'quarantine', dkim: 'fail', spf: 'fail', category: 'unknown' }] : []),
      ];
      rows.forEach((row, i) => this.data.dmarcRecords.push({ id: demoId('dmarc-record', `${k}-${i}`), reportId: id, headerFrom: domain, ...row, createdAt: plus(end, 6 * HOUR), updatedAt: plus(end, 6 * HOUR) }));
    }
  }

  /* ---------- Sync runs, alerts, activity log, exports, staff activity (14.4, ANL-11, AUD-19, M11) ---------- */

  private buildOperations() {
    const rng = new Random('operations');
    let runSeq = 0;
    const run = (source: string, startedAt: Date, input: { ok?: boolean; error?: string; rows?: number; windowFrom?: Date | null; by?: string; seconds?: number }) => {
      runSeq += 1;
      const ok = input.ok ?? true;
      const finishedAt = plus(startedAt, (input.seconds ?? rng.int(2, 40)) * 1000);
      const rows = ok ? (input.rows ?? rng.int(0, 40)) : 0;
      this.data.syncRuns.push({
        id: demoId('sync-run', runSeq), source, startedAt, finishedAt, status: ok ? 'ok' : 'failed', rowsIn: rows, rowsUpserted: ok ? Math.round(rows * 0.9) : 0,
        error: ok ? null : (input.error ?? 'Unknown error'), windowFrom: input.windowFrom ?? null, windowTo: startedAt, triggeredBy: input.by ?? 'scheduler',
        createdAt: startedAt, updatedAt: finishedAt,
      });
      return startedAt;
    };
    // Nightly sources: the latest 23:00 UTC slot that has passed (the runner skips a slot that already has a run).
    const slot = new Date(Date.UTC(this.now.getUTCFullYear(), this.now.getUTCMonth(), this.now.getUTCDate(), 23, 0));
    if (slot > this.now) slot.setTime(slot.getTime() - DAY);
    const nightly = (source: string, rows: [number, number], failLast = 0, slotOffsetMinutes = 0) => {
      let previous: Date | null = null;
      for (let k = 6; k >= 0; k -= 1) {
        const startedAt = new Date(Math.min(plus(slot, -k * DAY + (slotOffsetMinutes + rng.int(1, 3)) * MINUTE).getTime(), this.now.getTime() - 30_000));
        const failed = k < failLast;
        run(source, startedAt, { ok: !failed, error: failed ? `${source}: 401 invalid access token` : undefined, rows: rng.int(rows[0], rows[1]), windowFrom: previous, seconds: rng.int(20, 150) });
        if (!failed) previous = startedAt;
      }
    };
    nightly('website_analytics', [24, 32]);
    nightly('social_meta', [6, 8]);
    nightly('meta_ads', [8, 15], 2);
    nightly('google_ads', [6, 9]);
    nightly('raw_retention', [0, 30], 0, -30);
    run('google_ads', plus(this.now, -3 * DAY - 5 * HOUR), { rows: 62, by: STAFF.admin, seconds: 48 });

    const interval = (source: string, everyMinutes: number, runs: number, rows: [number, number], lastAgoMinutes: number, overlapMinutes: number) => {
      let previous: Date | null = null;
      for (let k = runs - 1; k >= 0; k -= 1) {
        const startedAt = plus(this.now, -(lastAgoMinutes + k * everyMinutes) * MINUTE);
        run(source, startedAt, { rows: rng.int(rows[0], rows[1]), windowFrom: previous ? plus(previous, -overlapMinutes * MINUTE) : null });
        previous = startedAt;
      }
    };
    interval('core_people', 15, 6, [0, 12], 6, 60);
    interval('core_outcomes', 15, 6, [0, 6], 6, 60);
    interval('crm_leads', 15, 6, [1, 20], 7, 60);
    interval('crm_stage_changes', 15, 6, [0, 9], 7, 60);
    interval('core_touches_push', 15, 6, [5, 60], 8, 60);
    interval('alumni_employment', 60, 5, [0, 4], 20, 120);
    // Stale: last successful pull five hours ago, more than three missed hourly runs (ANL-11).
    interval('alumni_referrals', 60, 4, [0, 3], 300, 120);
    interval('send_dispatcher', 1, 5, [0, 0], 1, 0);
    interval('newsletter_schedule', 60, 4, [0, 3], 25, 0);
    interval('sunset_policy', 24 * 60, 3, [0, 15], 180, 0);

    const metaFailedAt = this.data.syncRuns.filter((row) => row.source === 'meta_ads' && row.status === 'failed').map((row) => row.startedAt as Date);
    const legacy = this.data.contactImports.find((row) => row.id === this.importLegacy.id);
    const bounced = this.people.find((person) => person.leave?.reason === 'bounced' && person.leave.viaEmail) ?? this.people.find((person) => person.leave?.reason === 'bounced');
    const dmarcAt = (this.data.dmarcReports[0]?.createdAt as Date | undefined) ?? plus(this.now, -DAY);
    const guardrailSend = this.data.sends.find((row) => row.utmCampaign === 'autumn-intake-last-seats-en');
    const alerts: Row<typeof schema.alerts>[] = [
      { level: 'critical', roles: ['admin'], title: 'Failing twice in a row: Ad platform spend (meta_ads)', message: 'meta_ads: 401 invalid access token', link: '#/analytics/health', dedupeKey: 'job-streak:meta_ads', createdAt: plus(metaFailedAt[1] ?? this.now, 2 * MINUTE) },
      { level: 'warning', roles: ['admin'], title: 'Job failed: Ad platform spend (meta_ads)', message: 'meta_ads: 401 invalid access token', link: '#/analytics/health', dedupeKey: 'job:meta_ads', createdAt: plus(metaFailedAt[0] ?? this.now, 2 * MINUTE) },
      { level: 'warning', roles: ['marketing_manager', 'admin'], title: `Import “${this.importLegacy.fileName}” blocked from sends`, message: 'More than 10% of its contacts hard-bounced on their first send. Review the list, then unblock it on the Import screen.', link: '#/audience/import', dedupeKey: `import-blocked:${this.importLegacy.id}`, createdAt: (legacy?.sendBlockedAt as Date | undefined) ?? plus(this.now, -50 * DAY) },
      { level: 'warning', roles: ['admin'], title: 'DMARC failures from an unknown source', message: `mail-provider-a.example saw mail for news.academy-domain.invalid from 203.0.113.77 failing SPF and DKIM. If it is a service you use, add its IPs to DMARC_KNOWN_SOURCES; otherwise someone may be spoofing the domain.`, link: '#/email-settings', dedupeKey: 'dmarc-unknown:news.academy-domain.invalid:203.0.113.77', createdAt: dmarcAt },
      { level: 'warning', roles: ['marketing_manager', 'admin'], title: 'Address suppressed after repeated soft bounces', message: `${bounced?.email ?? 'an address'} soft-bounced 3 times in 30 days and no longer receives marketing email. Check the address with the person.`, link: bounced ? `#/audience/contacts/${bounced.id}` : null, dedupeKey: `soft-bounce:${bounced?.email ?? 'demo'}`, createdAt: bounced?.leave?.at ?? plus(this.now, -12 * DAY) },
      { level: 'critical', roles: ['marketing_manager'], title: `“${guardrailSend?.name ?? 'Campaign'}” paused by a deliverability guardrail`, message: 'hard bounces 5.4% in the first messages (limit 5%). Check the list and the content before resuming.', link: guardrailSend ? `#/campaigns/${guardrailSend.id}` : null, dedupeKey: `guardrail:${guardrailSend?.id ?? 'demo'}`, createdAt: plus((guardrailSend?.startedAt as Date | undefined) ?? plus(this.now, -52 * DAY), 4 * MINUTE), resolvedAt: plus((guardrailSend?.startedAt as Date | undefined) ?? plus(this.now, -52 * DAY), 50 * MINUTE), resolvedBy: STAFF.manager },
    ];
    alerts.forEach((alert, i) => this.data.alerts.push({ ...alert, id: demoId('alert', i + 1), updatedAt: alert.resolvedAt ?? alert.createdAt }));

    // Activity log (PRD 12.4): which fields changed, never their values.
    let auditSeq = 0;
    const audit = (entityId: string, action: string, actorId: string, fields: string[], moment: Date) => {
      auditSeq += 1;
      this.data.auditEvents.push({ id: demoId('audit', auditSeq), entityType: 'contact', entityId, action, actorId, fields, createdAt: moment, updatedAt: moment });
    };
    const recent = plus(this.now, -60 * DAY);
    for (const person of this.people) {
      if (person.importId && person.firstTouchAt > recent) audit(person.id, 'contact.imported', STAFF.editor, ['email', 'firstName', 'lastName', 'language'], person.firstTouchAt);
      else if (person.lead && person.lead > recent) audit(person.id, 'contact.created', 'system:navigator_crm', ['email', 'firstName', 'lastName', 'crmLeadId', 'crmStage'], person.lead);
      else if (person.firstTouchAt > plus(this.now, -14 * DAY) && !person.lead) audit(person.id, 'contact.created', 'system:signup', ['email', 'language', 'sourceChannel'], person.firstTouchAt);
      if (person.tags.length && person.firstTouchAt > recent) audit(person.id, 'contact.updated', STAFF.editor, ['tags'], plus(person.firstTouchAt, 2 * DAY));
      if (person.enrolled && person.enrolled > recent) audit(person.id, 'contact.updated', 'system:core_engine', ['type', 'corePersonId'], person.enrolled);
    }
    this.data.auditEvents.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());

    const exports: [string, string | null, number][] = [['nl-hy', null, 40], ['attendees-180', null, 21], ['leads-90', null, 9]];
    exports.forEach(([key, , daysAgo], i) => {
      const segment = this.data.segments.find((row) => row.id === this.segmentIds.get(key));
      const moment = plus(this.now, -daysAgo * DAY);
      this.data.exportLog.push({ id: demoId('export', i + 1), actorId: STAFF.manager, kind: 'segment_csv', segmentId: segment?.id ?? null, segmentName: segment?.name ?? null, rowCount: rng.int(40, 600), createdAt: moment, updatedAt: moment });
    });
    const requester = this.people[120] as Person;
    this.data.exportLog.push({ id: demoId('export', 4), actorId: STAFF.admin, kind: 'contact_data', contactId: requester.id, rowCount: 1, createdAt: plus(this.now, -6 * DAY), updatedAt: plus(this.now, -6 * DAY) });

    // M11: staff who opened the Overview per ISO week.
    const users: [string, string, number][] = [['staff-editor', 'editor', 0.95], ['staff-marketing_manager', 'marketing_manager', 1], ['staff-admin', 'admin', 0.7], ['staff-viewer', 'viewer', 0.5], ['staff-leadership', 'leadership', 0.6]];
    for (let week = 7; week >= 0; week -= 1) {
      const moment = plus(this.now, -week * 7 * DAY);
      for (const [userId, role, p] of users) {
        if (week > 0 && !rng.chance(p)) continue;
        this.data.staffActivity.push({ userId, week: isoWeek(moment), role, views: rng.int(2, 18), createdAt: moment, updatedAt: moment });
      }
    }
  }
}
