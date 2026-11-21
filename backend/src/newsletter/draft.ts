import type { Language } from '../integrations/core-engine/contract.js';
import type { CollectedItem, ItemType } from './collectors.js';

export const BLOCK_TYPES = ['lead', 'upcoming_events', 'recent_events', 'library', 'graduations', 'hires', 'new_groups', 'cta', 'custom'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Ranking settings (8.1 step 2): weight per item type and how fast older items lose weight. */
export type RankingSettings = { weights: Record<ItemType, number>; halfLifeDays: number };

export const DEFAULT_RANKING: RankingSettings = {
  weights: { graduation: 1, hire: 0.9, new_group: 0.8, upcoming_event: 0.8, recent_event: 0.6, library: 0.5 },
  halfLifeDays: 14,
};

export function score(item: Pick<CollectedItem, 'type' | 'occurredAt'>, now: Date, settings: RankingSettings): number {
  const ageDays = Math.abs(now.getTime() - item.occurredAt.getTime()) / 86_400_000;
  return settings.weights[item.type] * 0.5 ** (ageDays / settings.halfLifeDays);
}

const BLOCK_FOR: Record<ItemType, BlockType> = {
  upcoming_event: 'upcoming_events',
  recent_event: 'recent_events',
  library: 'library',
  graduation: 'graduations',
  hire: 'hires',
  new_group: 'new_groups',
};

/** Items per block; the rest stay collected and can be swapped in by the editor (NWS-05). */
const LIMIT: Partial<Record<BlockType, number>> = { upcoming_events: 4, recent_events: 3, library: 5, graduations: 3, hires: 3, new_groups: 4 };

const ORDER: BlockType[] = ['lead', 'upcoming_events', 'new_groups', 'recent_events', 'graduations', 'hires', 'library', 'cta'];

export const BLOCK_TITLES: Record<Language, Record<BlockType, string>> = {
  en: { lead: 'This month', upcoming_events: 'Upcoming events', recent_events: 'Recent events', library: 'New in the Library', graduations: 'Graduations', hires: 'Alumni hires', new_groups: 'New groups starting', cta: 'Join us', custom: 'News' },
  hy: { lead: 'Այս ամիս', upcoming_events: 'Առաջիկա միջոցառումներ', recent_events: 'Անցած միջոցառումներ', library: 'Նոր Գրադարանում', graduations: 'Ավարտական', hires: 'Շրջանավարտների աշխատանք', new_groups: 'Նոր խմբեր', cta: 'Միացեք մեզ', custom: 'Նորություններ' },
  ru: { lead: 'В этом месяце', upcoming_events: 'Скоро', recent_events: 'Прошедшие события', library: 'Новое в Библиотеке', graduations: 'Выпуски', hires: 'Трудоустройство выпускников', new_groups: 'Набор в новые группы', cta: 'Присоединяйтесь', custom: 'Новости' },
};

const WORDS: Record<Language, { register: string; watch: string; read: string; apply: string; graduates: (n: number, course: string) => string; starts: string; ctaBody: string; ctaButton: string }> = {
  en: {
    register: 'Register',
    watch: 'Watch',
    read: 'Read',
    apply: 'Apply',
    graduates: (n, course) => `${n} graduates finished ${course}. Congratulations!`,
    starts: 'starts',
    ctaBody: 'Thinking about your next step in tech? Our admissions team will help you choose a course.',
    ctaButton: 'Talk to admissions',
  },
  hy: {
    register: 'Գրանցվել',
    watch: 'Դիտել',
    read: 'Կարդալ',
    apply: 'Դիմել',
    graduates: (n, course) => `${n} շրջանավարտ ավարտեց ${course} դասընթացը։ Շնորհավորում ենք։`,
    starts: 'մեկնարկ',
    ctaBody: 'Մտածո՞ւմ եք ձեր հաջորդ քայլի մասին տեխնոլոգիաներում։ Ընդունելության թիմը կօգնի ընտրել դասընթացը։',
    ctaButton: 'Կապվել ընդունելության հետ',
  },
  ru: {
    register: 'Зарегистрироваться',
    watch: 'Смотреть',
    read: 'Читать',
    apply: 'Подать заявку',
    graduates: (n, course) => `${n} выпускников окончили курс ${course}. Поздравляем!`,
    starts: 'старт',
    ctaBody: 'Думаете о следующем шаге в IT? Приёмная комиссия поможет выбрать курс.',
    ctaButton: 'Связаться с приёмной комиссией',
  },
};

const INTL: Record<Language, string> = { en: 'en-GB', hy: 'hy-AM', ru: 'ru-RU' };
const day = (value: Date | string, language: Language) =>
  new Intl.DateTimeFormat(INTL[language], { day: 'numeric', month: 'long', timeZone: 'Asia/Yerevan' }).format(new Date(value));

/** Title in the issue's language when the source has one. */
export function localTitle(item: Pick<CollectedItem, 'title' | 'payload'>, language: Language): string {
  const titles = (item.payload.titles ?? {}) as Partial<Record<Language, string>>;
  return titles[language] ?? item.title;
}

/** One line of a block body for an item, in the safe markup of campaign bodies. */
export function itemLine(item: CollectedItem, language: Language): string {
  const w = WORDS[language];
  const title = localTitle(item, language).replace(/[[\]*]/g, '');
  const p = item.payload as Record<string, unknown>;
  switch (item.type) {
    case 'upcoming_event':
      return `**${title}**, ${day(item.occurredAt, language)}. [${w.register}](${item.url})`;
    case 'recent_event':
      return `**${title}**, ${day(item.occurredAt, language)}. [${w.watch}](${item.url})`;
    case 'library':
      return `[${title}](${item.url})`;
    case 'graduation':
      return w.graduates(Number(p.graduates ?? 0), title);
    case 'hire':
      return `**${title}**`;
    case 'new_group':
      return `**${title}**, ${w.starts} ${day(String(p.startDate), language)}. [${w.apply}](${item.url})`;
  }
}

export type DraftBlock = {
  type: BlockType;
  title: string;
  body: string;
  itemIds: string[];
  buttonLabel: string | null;
  buttonUrl: string | null;
};

/**
 * Fills the template with ranked, publishable items (NWS-03): the best item becomes the lead story, the rest
 * go to their blocks up to each block's limit; empty blocks are left out; a call to action closes the issue.
 */
export function buildDraft(items: CollectedItem[], language: Language, now: Date, options: { ranking?: RankingSettings; ctaUrl: string }): DraftBlock[] {
  const ranking = options.ranking ?? DEFAULT_RANKING;
  const ranked = items.filter((item) => item.publishable).sort((a, b) => score(b, now, ranking) - score(a, now, ranking));
  const titles = BLOCK_TITLES[language];
  const blocks = new Map<BlockType, DraftBlock>();
  const [lead, ...rest] = ranked;
  if (lead) {
    blocks.set('lead', { type: 'lead', title: localTitle(lead, language), body: itemLine(lead, language), itemIds: [lead.id], buttonLabel: null, buttonUrl: null });
  }
  for (const item of rest) {
    const type = BLOCK_FOR[item.type];
    const block = blocks.get(type) ?? { type, title: titles[type], body: '', itemIds: [], buttonLabel: null, buttonUrl: null };
    if (block.itemIds.length >= (LIMIT[type] ?? 5)) continue;
    block.itemIds.push(item.id);
    block.body = block.body ? `${block.body}\n\n${itemLine(item, language)}` : itemLine(item, language);
    blocks.set(type, block);
  }
  const w = WORDS[language];
  blocks.set('cta', { type: 'cta', title: titles.cta, body: w.ctaBody, itemIds: [], buttonLabel: w.ctaButton, buttonUrl: options.ctaUrl });
  return ORDER.flatMap((type) => (blocks.has(type) ? [blocks.get(type) as DraftBlock] : []));
}
