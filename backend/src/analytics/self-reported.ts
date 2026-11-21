import { and, gte, inArray, isNotNull, lt, eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, outcomes } from '../db/schema.js';
import { credit, UNATTRIBUTED, UNMAPPED, window, anchorFor, type AttributionService } from './attribution.js';
import { suppress, type Count } from './overview.js';
import type { DateRange } from './sources/contract.js';

/**
 * Answers to "How did you hear about us?" are free text in three languages, and people rarely know whether a
 * post was an ad, so the comparison uses broader groups than the taxonomy.
 */
export const SOURCE_GROUPS = ['social', 'search_website', 'email', 'events', 'referrals', 'chatbot', 'partners_press'] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export const GROUP_LABEL: Record<SourceGroup, string> = {
  social: 'Social media (paid or organic)',
  search_website: 'Search and website (paid or organic)',
  email: 'Email',
  events: 'Events and open days',
  referrals: 'Referrals and word of mouth',
  chatbot: 'Chatbot',
  partners_press: 'Partners and press',
};

const CHANNEL_GROUP: Record<string, SourceGroup> = {
  paid_social: 'social',
  organic_social: 'social',
  search_website: 'search_website',
  paid_search: 'search_website',
  email: 'email',
  events: 'events',
  referrals: 'referrals',
  chatbot: 'chatbot',
  partners_press: 'partners_press',
};

/** Keywords in English, Russian and Armenian; the first group that matches wins. */
const KEYWORDS: [SourceGroup, RegExp][] = [
  ['referrals', /friend|alumn|student|colleague|referr|recommend|family|word of mouth|друг|друз|знаком|коллег|выпускник|рекоменд|ընկեր|ծանոթ|շրջանավարտ|խորհուրդ/i],
  ['chatbot', /chat ?bot|\bbot\b|чат-?бот|չաթբոտ/i],
  ['events', /event|open day|workshop|meetup|hackathon|webinar|мероприят|день открытых|воркшоп|вебинар|хакатон|միջոցառ|բաց դռ|վեբինար/i],
  ['email', /e-?mail|newsletter|mail|рассылк|почт|письм|նամակ|տեղեկագիր/i],
  ['social', /insta|facebook|\bfb\b|tik ?tok|linkedin|telegram|youtube|social|соцсет|инстаграм|фейсбук|телеграм|ютуб|սոցցանց|ինստագրամ|ֆեյսբուք|տելեգրամ/i],
  ['search_website', /google|search|website|\bsite\b|internet|online|yandex|гугл|поиск|сайт|интернет|яндекс|գուգլ|կայք|որոնում|ինտերնետ/i],
  ['partners_press', /partner|universit|press|news|article|media|company|employer|партн|университет|вуз|стать|новост|сми|компани|գործընկեր|համալսարան|հոդված|լրատվ|ընկերություն/i],
];

export function groupOfAnswer(answer: string | null | undefined): SourceGroup | null {
  const text = answer?.trim();
  if (!text) return null;
  return KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export type SelfReportedComparison = {
  period: DateRange;
  /** Applicants in the period with an answer and a tracked first touch, compared. */
  compared: Count;
  agreed: Count;
  /** Share of compared applicants whose answer matches the tracked first-touch group; null when hidden or none. */
  agreementRate: number | null;
  withoutAnswer: Count;
  unrecognisedAnswers: Count;
  /** Applicants with an answer but no tracked touch: what tracking misses. */
  untracked: Count;
  matrix: { reported: SourceGroup; tracked: SourceGroup | 'unmapped'; count: Count }[];
  groups: Record<SourceGroup, string>;
};

/** Self-reported source against tracked first touch for the applicants of a period (PRD 9.4, ANL-16). */
export class SelfReportedService {
  constructor(private readonly deps: { db: AppPgDatabase; attribution: AttributionService }) {}

  async compare(range: DateRange, shared: boolean): Promise<SelfReportedComparison> {
    const start = new Date(`${range.from}T00:00:00+04:00`);
    const end = new Date(new Date(`${range.to}T00:00:00+04:00`).getTime() + 86_400_000);
    const applicants = await this.deps.db
      .selectDistinct({ id: contacts.id, answer: contacts.selfReportedSource })
      .from(outcomes)
      .innerJoin(contacts, eq(outcomes.contactId, contacts.id))
      .where(and(eq(outcomes.type, 'applied'), isNotNull(outcomes.contactId), gte(outcomes.occurredAt, start), lt(outcomes.occurredAt, end)));
    const people = await this.deps.attribution.people(applicants.map((row) => row.id));
    let compared = 0;
    let agreed = 0;
    let withoutAnswer = 0;
    let unrecognised = 0;
    let untracked = 0;
    const cells = new Map<string, number>();
    for (const applicant of applicants) {
      const reported = groupOfAnswer(applicant.answer);
      if (!applicant.answer?.trim()) {
        withoutAnswer += 1;
        continue;
      }
      if (!reported) {
        unrecognised += 1;
        continue;
      }
      const person = people.get(applicant.id);
      const first = person ? credit(window(person.touches, anchorFor(person, new Date())), 'first_touch')[0] : undefined;
      if (!first || first.channel === UNATTRIBUTED) {
        untracked += 1;
        continue;
      }
      const tracked = first.channel === UNMAPPED ? 'unmapped' : (CHANNEL_GROUP[first.channel] ?? 'unmapped');
      compared += 1;
      if (tracked === reported) agreed += 1;
      cells.set(`${reported}|${tracked}`, (cells.get(`${reported}|${tracked}`) ?? 0) + 1);
    }
    const hidden = (value: number) => suppress(value, shared);
    const rateHidden = shared && compared > 0 && (compared < 3 || (agreed > 0 && agreed < 3) || (compared - agreed > 0 && compared - agreed < 3));
    return {
      period: range,
      compared: hidden(compared),
      agreed: hidden(agreed),
      agreementRate: compared === 0 || rateHidden ? null : agreed / compared,
      withoutAnswer: hidden(withoutAnswer),
      unrecognisedAnswers: hidden(unrecognised),
      untracked: hidden(untracked),
      matrix: [...cells].map(([key, count]) => {
        const [reported, tracked] = key.split('|') as [SourceGroup, SourceGroup | 'unmapped'];
        return { reported, tracked, count: hidden(count) };
      }),
      groups: GROUP_LABEL,
    };
  }
}
