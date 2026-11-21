import { useSyncExternalStore } from 'react';
import type { Language, Topic } from '../lib/api';

/**
 * Public pages speak Armenian, English and Russian (PRD 13.7, 14.5). The language comes from the person's
 * record when the API answers, otherwise from the browser; the switch in the header overrides both.
 */
export const PUBLIC_LANGUAGES: { value: Language; label: string }[] = [
  { value: 'hy', label: 'Հայերեն' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

type Strings = {
  languageLabel: string;
  privacyLink: string;
  genericError: string;
  rateLimited: string;
  linkInvalidTitle: string;
  linkInvalidText: string;
  linkExpiredTitle: string;
  linkExpiredText: string;
  unsubWorking: string;
  unsubDoneTitle: string;
  unsubDoneText: string;
  unsubUndo: string;
  unsubUndoneTitle: string;
  unsubUndoneText: string;
  unsubToPreferences: string;
  prefsTitle: string;
  prefsFor: (email: string) => string;
  prefsTopics: string;
  prefsTopicsHint: string;
  topics: Record<Topic, { label: string; description: string }>;
  prefsLanguage: string;
  prefsFrequency: string;
  frequencyAll: string;
  frequencyMonthly: string;
  prefsSave: string;
  prefsSaved: string;
  prefsSuppressed: string;
  prefsUnsubscribeAll: string;
  prefsUnsubscribedAll: string;
  prefsDataNote: string;
  stayDone: string;
  confirmWorking: string;
  confirmDoneTitle: string;
  confirmDoneText: string;
  privacyTitle: string;
  privacyDraft: string;
  privacySections: { title: string; text: string }[];
};

const en: Strings = {
  languageLabel: 'Language',
  privacyLink: 'How we use your data',
  genericError: 'Something went wrong. Please try again in a minute.',
  rateLimited: 'Too many attempts. Please wait a minute and try again.',
  linkInvalidTitle: 'This link does not work',
  linkInvalidText: 'Use the link from a recent email from Picsart Academy, or write to us and we will help.',
  linkExpiredTitle: 'This link has expired',
  linkExpiredText: 'Use the link from a more recent email from Picsart Academy.',
  unsubWorking: 'Unsubscribing…',
  unsubDoneTitle: 'You are unsubscribed',
  unsubDoneText:
    'You will not receive marketing emails from Picsart Academy any more. Messages about your own studies, such as interview or payment reminders, still arrive.',
  unsubUndo: 'Undo: keep me subscribed',
  unsubUndoneTitle: 'You are subscribed again',
  unsubUndoneText: 'Nothing changed: you keep receiving the emails you chose before.',
  unsubToPreferences: 'Choose topics instead',
  prefsTitle: 'Email preferences',
  prefsFor: (email) => `For ${email}`,
  prefsTopics: 'What would you like to receive?',
  prefsTopicsHint: 'Untick everything to stop a topic. You can come back here at any time.',
  topics: {
    newsletter: { label: 'Newsletter', description: 'A monthly digest of news, events and stories from the Academy.' },
    courses: { label: 'Courses', description: 'New courses and enrollment dates.' },
    events: { label: 'Events', description: 'Open days, workshops and meetups.' },
    alumni: { label: 'Alumni', description: 'Alumni news, job opportunities and community events.' },
  },
  prefsLanguage: 'Language of emails',
  prefsFrequency: 'How often',
  frequencyAll: 'Everything I chose above',
  frequencyMonthly: 'At most one email a month',
  prefsSave: 'Save preferences',
  prefsSaved: 'Your preferences are saved.',
  prefsSuppressed: 'You are unsubscribed from all marketing email. Tick a topic and save to subscribe again.',
  prefsUnsubscribeAll: 'Unsubscribe from everything',
  prefsUnsubscribedAll: 'You are unsubscribed from everything.',
  prefsDataNote:
    'We record which emails you open and which links you click, to send fewer and better emails. Opens are estimated. We do not use third-party tracking cookies.',
  stayDone: 'Thank you! You stay subscribed. You can change topics below.',
  confirmWorking: 'Confirming your subscription…',
  confirmDoneTitle: 'Subscription confirmed',
  confirmDoneText: 'Thank you. The first email will arrive with the next issue.',
  privacyTitle: 'How Picsart Academy uses your marketing data',
  privacyDraft: 'Draft notice: the final text is confirmed with the Academy’s legal advisor.',
  privacySections: [
    { title: 'Who we are', text: 'Picsart Academy decides how your marketing data is used. Write to privacy@academy-domain for any question about your data.' },
    {
      title: 'What we keep',
      text: 'Your name, email address, phone number if you gave it, preferred language, which topics you agreed to receive and when, where you first heard about us, and which of our emails you received, opened or clicked.',
    },
    { title: 'Why', text: 'To send you the emails you asked for, in your language, and to learn which of our activities help people join and finish our courses. Reports to the Academy’s leadership show totals only, never individual people.' },
    { title: 'What we do not do', text: 'We do not sell your data, do not use third-party tracking cookies and do not follow you across other websites.' },
    { title: 'Your rights', text: 'You can unsubscribe in one click from any email, change your preferences at any time, and ask for a copy of your data or for its deletion. We answer within 30 days.' },
    { title: 'How long', text: 'We keep your record while you receive our emails or study with us. If you ask us to delete it, we remove your personal data and keep only an anonymous line for totals and a coded fingerprint of your address, so we never email you again by mistake.' },
  ],
};

const hy: Strings = {
  languageLabel: 'Լեզու',
  privacyLink: 'Ինչպես ենք օգտագործում ձեր տվյալները',
  genericError: 'Ինչ-որ բան սխալ գնաց։ Խնդրում ենք փորձել մեկ րոպեից։',
  rateLimited: 'Չափազանց շատ փորձեր։ Սպասեք մեկ րոպե և փորձեք կրկին։',
  linkInvalidTitle: 'Այս հղումը չի աշխատում',
  linkInvalidText: 'Օգտագործեք Picsart Academy-ի վերջին նամակներից մեկի հղումը կամ գրեք մեզ, և մենք կօգնենք։',
  linkExpiredTitle: 'Այս հղման ժամկետն անցել է',
  linkExpiredText: 'Օգտագործեք Picsart Academy-ի ավելի նոր նամակի հղումը։',
  unsubWorking: 'Ապաբաժանորդագրում ենք…',
  unsubDoneTitle: 'Դուք ապաբաժանորդագրվել եք',
  unsubDoneText:
    'Այլևս չեք ստանա Picsart Academy-ի մարքեթինգային նամակներ։ Ձեր ուսմանը վերաբերող հաղորդագրությունները, օրինակ՝ հարցազրույցի կամ վճարման հիշեցումները, կշարունակեն գալ։',
  unsubUndo: 'Չեղարկել՝ թողնել բաժանորդագրությունը',
  unsubUndoneTitle: 'Դուք կրկին բաժանորդագրված եք',
  unsubUndoneText: 'Ոչինչ չի փոխվել․ կշարունակեք ստանալ նախկինում ընտրած նամակները։',
  unsubToPreferences: 'Փոխարենը ընտրել թեմաները',
  prefsTitle: 'Նամակների կարգավորումներ',
  prefsFor: (email) => `${email} հասցեի համար`,
  prefsTopics: 'Ի՞նչ կցանկանայիք ստանալ',
  prefsTopicsHint: 'Հանեք նշումը՝ թեման դադարեցնելու համար։ Կարող եք ցանկացած պահի վերադառնալ այստեղ։',
  topics: {
    newsletter: { label: 'Տեղեկագիր', description: 'Ակադեմիայի նորությունների, միջոցառումների և պատմությունների ամսական ամփոփում։' },
    courses: { label: 'Դասընթացներ', description: 'Նոր դասընթացներ և ընդունելության ժամկետներ։' },
    events: { label: 'Միջոցառումներ', description: 'Բաց դռների օրեր, սեմինարներ և հանդիպումներ։' },
    alumni: { label: 'Շրջանավարտներ', description: 'Շրջանավարտների նորություններ, աշխատանքային հնարավորություններ և համայնքային միջոցառումներ։' },
  },
  prefsLanguage: 'Նամակների լեզուն',
  prefsFrequency: 'Որքան հաճախ',
  frequencyAll: 'Վերևում ընտրված ամեն ինչ',
  frequencyMonthly: 'Ամսական առավելագույնը մեկ նամակ',
  prefsSave: 'Պահպանել',
  prefsSaved: 'Ձեր կարգավորումները պահպանված են։',
  prefsSuppressed: 'Դուք ապաբաժանորդագրված եք բոլոր մարքեթինգային նամակներից։ Նշեք թեման և պահպանեք՝ կրկին բաժանորդագրվելու համար։',
  prefsUnsubscribeAll: 'Ապաբաժանորդագրվել ամեն ինչից',
  prefsUnsubscribedAll: 'Դուք ապաբաժանորդագրվել եք ամեն ինչից։',
  prefsDataNote:
    'Մենք գրանցում ենք, թե որ նամակներն եք բացում և որ հղումներով անցնում, որպեսզի ուղարկենք ավելի քիչ և ավելի օգտակար նամակներ։ Բացումները մոտավոր են։ Մենք չենք օգտագործում երրորդ կողմի հետևող cookie-ներ։',
  stayDone: 'Շնորհակալություն։ Դուք մնում եք բաժանորդագրված։ Թեմաները կարող եք փոխել ներքևում։',
  confirmWorking: 'Հաստատում ենք բաժանորդագրությունը…',
  confirmDoneTitle: 'Բաժանորդագրությունը հաստատված է',
  confirmDoneText: 'Շնորհակալություն։ Առաջին նամակը կգա հաջորդ թողարկման հետ։',
  privacyTitle: 'Ինչպես է Picsart Academy-ն օգտագործում ձեր մարքեթինգային տվյալները',
  privacyDraft: 'Նախնական տարբերակ․ վերջնական տեքստը հաստատվում է Ակադեմիայի իրավախորհրդատուի հետ։',
  privacySections: [
    { title: 'Ով ենք մենք', text: 'Picsart Academy-ն է որոշում, թե ինչպես են օգտագործվում ձեր մարքեթինգային տվյալները։ Տվյալների վերաբերյալ հարցերի դեպքում գրեք privacy@academy-domain հասցեին։' },
    {
      title: 'Ինչ ենք պահում',
      text: 'Ձեր անունը, էլ. հասցեն, հեռախոսահամարը (եթե տրամադրել եք), նախընտրած լեզուն, թե որ թեմաներին և երբ եք համաձայնել, որտեղից եք առաջին անգամ իմացել մեր մասին, և թե մեր որ նամակներն եք ստացել, բացել կամ որ հղումներով անցել։',
    },
    { title: 'Ինչու', text: 'Որպեսզի ուղարկենք ձեր խնդրած նամակները ձեր լեզվով և հասկանանք, թե մեր որ գործողություններն են օգնում մարդկանց ընդունվել և ավարտել դասընթացները։ Ակադեմիայի ղեկավարությանը ներկայացվում են միայն ընդհանուր թվեր, երբեք՝ առանձին անձինք։' },
    { title: 'Ինչ չենք անում', text: 'Մենք չենք վաճառում ձեր տվյալները, չենք օգտագործում երրորդ կողմի հետևող cookie-ներ և չենք հետևում ձեզ այլ կայքերում։' },
    { title: 'Ձեր իրավունքները', text: 'Կարող եք ցանկացած նամակից ապաբաժանորդագրվել մեկ սեղմումով, ցանկացած պահի փոխել կարգավորումները, խնդրել ձեր տվյալների պատճենը կամ դրանց ջնջումը։ Պատասխանում ենք 30 օրվա ընթացքում։' },
    { title: 'Որքան ժամանակ', text: 'Պահում ենք ձեր գրառումը, քանի դեռ ստանում եք մեր նամակները կամ սովորում եք մեզ մոտ։ Ջնջման խնդրանքի դեպքում հեռացնում ենք անձնական տվյալները և պահում միայն անանուն տող՝ ընդհանուր թվերի համար, և ձեր հասցեի կոդավորված հետքը, որպեսզի սխալմամբ այլևս նամակ չուղարկենք։' },
  ],
};

const ru: Strings = {
  languageLabel: 'Язык',
  privacyLink: 'Как мы используем ваши данные',
  genericError: 'Что-то пошло не так. Пожалуйста, попробуйте через минуту.',
  rateLimited: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  linkInvalidTitle: 'Эта ссылка не работает',
  linkInvalidText: 'Воспользуйтесь ссылкой из недавнего письма Picsart Academy или напишите нам, и мы поможем.',
  linkExpiredTitle: 'Срок действия ссылки истёк',
  linkExpiredText: 'Воспользуйтесь ссылкой из более свежего письма Picsart Academy.',
  unsubWorking: 'Отписываем…',
  unsubDoneTitle: 'Вы отписались',
  unsubDoneText:
    'Вы больше не будете получать маркетинговые письма Picsart Academy. Письма о вашем обучении, например напоминания о собеседовании или оплате, продолжат приходить.',
  unsubUndo: 'Отменить: оставить подписку',
  unsubUndoneTitle: 'Подписка восстановлена',
  unsubUndoneText: 'Ничего не изменилось: вы получаете те же письма, что и раньше.',
  unsubToPreferences: 'Вместо этого выбрать темы',
  prefsTitle: 'Настройки рассылки',
  prefsFor: (email) => `Для ${email}`,
  prefsTopics: 'Что вы хотите получать?',
  prefsTopicsHint: 'Снимите отметку, чтобы отказаться от темы. Вернуться сюда можно в любое время.',
  topics: {
    newsletter: { label: 'Рассылка', description: 'Ежемесячный обзор новостей, мероприятий и историй Академии.' },
    courses: { label: 'Курсы', description: 'Новые курсы и даты набора.' },
    events: { label: 'Мероприятия', description: 'Дни открытых дверей, воркшопы и встречи.' },
    alumni: { label: 'Выпускники', description: 'Новости выпускников, вакансии и события сообщества.' },
  },
  prefsLanguage: 'Язык писем',
  prefsFrequency: 'Как часто',
  frequencyAll: 'Всё, что выбрано выше',
  frequencyMonthly: 'Не больше одного письма в месяц',
  prefsSave: 'Сохранить',
  prefsSaved: 'Настройки сохранены.',
  prefsSuppressed: 'Вы отписаны от всех маркетинговых писем. Отметьте тему и сохраните, чтобы подписаться снова.',
  prefsUnsubscribeAll: 'Отписаться от всего',
  prefsUnsubscribedAll: 'Вы отписались от всего.',
  prefsDataNote:
    'Мы отмечаем, какие письма вы открываете и по каким ссылкам переходите, чтобы присылать меньше писем и полезнее. Открытия считаются приблизительно. Мы не используем сторонние отслеживающие cookie.',
  stayDone: 'Спасибо! Подписка сохранена. Темы можно изменить ниже.',
  confirmWorking: 'Подтверждаем подписку…',
  confirmDoneTitle: 'Подписка подтверждена',
  confirmDoneText: 'Спасибо. Первое письмо придёт со следующим выпуском.',
  privacyTitle: 'Как Picsart Academy использует ваши маркетинговые данные',
  privacyDraft: 'Черновик: окончательный текст согласуется с юристом Академии.',
  privacySections: [
    { title: 'Кто мы', text: 'Picsart Academy определяет, как используются ваши маркетинговые данные. По любым вопросам о данных пишите на privacy@academy-domain.' },
    {
      title: 'Что мы храним',
      text: 'Ваше имя, адрес электронной почты, телефон (если вы его указали), предпочитаемый язык, на какие темы и когда вы дали согласие, откуда вы впервые узнали о нас, и какие наши письма вы получили, открыли или по каким ссылкам перешли.',
    },
    { title: 'Зачем', text: 'Чтобы присылать письма, о которых вы просили, на вашем языке, и понимать, какие наши действия помогают людям поступать и заканчивать курсы. Руководству Академии показываются только общие цифры, никогда отдельные люди.' },
    { title: 'Чего мы не делаем', text: 'Мы не продаём ваши данные, не используем сторонние отслеживающие cookie и не следим за вами на других сайтах.' },
    { title: 'Ваши права', text: 'Вы можете отписаться одним нажатием из любого письма, в любой момент изменить настройки, запросить копию своих данных или их удаление. Мы отвечаем в течение 30 дней.' },
    { title: 'Как долго', text: 'Мы храним вашу запись, пока вы получаете наши письма или учитесь у нас. По запросу на удаление мы стираем личные данные и оставляем только анонимную строку для общих цифр и закодированный отпечаток адреса, чтобы по ошибке больше вам не писать.' },
  ],
};

export const STRINGS: Record<Language, Strings> = { en, hy, ru };

const listeners = new Set<() => void>();
let chosen: Language | null = null;

function browserLanguage(): Language {
  const lang = navigator.language.slice(0, 2);
  return lang === 'en' || lang === 'ru' ? lang : 'hy';
}

export function setPublicLanguage(language: Language) {
  chosen = language;
  document.documentElement.lang = language;
  listeners.forEach((listener) => listener());
}

/** Sets the language from the person's record unless they already picked one on this page. */
export function suggestPublicLanguage(language: Language) {
  if (chosen === null) setPublicLanguage(language);
}

export function usePublicLanguage(): [Language, Strings] {
  const language = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => chosen ?? browserLanguage(),
    () => 'hy' as Language,
  );
  return [language, STRINGS[language]];
}
