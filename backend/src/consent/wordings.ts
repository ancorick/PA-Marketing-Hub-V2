import type { Language } from '../integrations/core-engine/contract.js';

/** Marketing topics a contact consents to separately (PRD 12.1). */
export const TOPICS = ['newsletter', 'courses', 'events', 'alumni'] as const;
export type Topic = (typeof TOPICS)[number];

export const CONSENT_STATES = ['granted', 'withdrawn', 'unknown', 'pending'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const CONSENT_METHODS = ['form', 'event', 'import', 'manual', 'link'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export type ConsentWording = { version: string; topic: Topic; language: Language; text: string };

/**
 * Versioned consent wording shown on forms (6.3 rule 4). A record stores the version; the exact text lives
 * here. Never edit a published version: add a new one, so old records keep pointing at what people saw.
 * The texts are drafts until the Academy's leadership and legal advisor confirm them (PRD 14.1, question 3).
 */
export const CONSENT_WORDINGS: ConsentWording[] = [
  { version: 'newsletter-en-v1', topic: 'newsletter', language: 'en', text: 'Yes, send me the Picsart Academy newsletter. I can unsubscribe at any time with one click.' },
  { version: 'newsletter-hy-v1', topic: 'newsletter', language: 'hy', text: 'Այո, ուղարկեք ինձ Picsart Academy-ի տեղեկագիրը։ Ես կարող եմ ցանկացած պահի դադարեցնել բաժանորդագրությունը մեկ սեղմումով։' },
  { version: 'newsletter-ru-v1', topic: 'newsletter', language: 'ru', text: 'Да, присылайте мне рассылку Picsart Academy. Я могу отписаться в любой момент одним нажатием.' },
  { version: 'courses-en-v1', topic: 'courses', language: 'en', text: 'Tell me about new courses and enrollment dates at Picsart Academy.' },
  { version: 'courses-hy-v1', topic: 'courses', language: 'hy', text: 'Տեղեկացրեք ինձ Picsart Academy-ի նոր դասընթացների և ընդունելության ժամկետների մասին։' },
  { version: 'courses-ru-v1', topic: 'courses', language: 'ru', text: 'Сообщайте мне о новых курсах и датах набора в Picsart Academy.' },
  { version: 'events-en-v1', topic: 'events', language: 'en', text: 'Invite me to Picsart Academy events, open days and workshops.' },
  { version: 'events-hy-v1', topic: 'events', language: 'hy', text: 'Հրավիրեք ինձ Picsart Academy-ի միջոցառումներին, բաց դռների օրերին և սեմինարներին։' },
  { version: 'events-ru-v1', topic: 'events', language: 'ru', text: 'Приглашайте меня на мероприятия, дни открытых дверей и воркшопы Picsart Academy.' },
  { version: 'alumni-en-v1', topic: 'alumni', language: 'en', text: 'Send me alumni news, job opportunities and community events.' },
  { version: 'alumni-hy-v1', topic: 'alumni', language: 'hy', text: 'Ուղարկեք ինձ շրջանավարտների նորություններ, աշխատանքային հնարավորություններ և համայնքային միջոցառումներ։' },
  { version: 'alumni-ru-v1', topic: 'alumni', language: 'ru', text: 'Присылайте мне новости выпускников, вакансии и события сообщества.' },
];

export const findWording = (version: string) => CONSENT_WORDINGS.find((wording) => wording.version === version) ?? null;

/** The current wording for a topic in a language (the highest version). */
export const currentWording = (topic: Topic, language: Language) =>
  CONSENT_WORDINGS.filter((wording) => wording.topic === topic && wording.language === language).at(-1) ?? null;
