/**
 * Texts of the demo data set (docs/RESTRUCTURE.md R2). Every name is made up and every address uses a domain
 * reserved for examples (RFC 2606), so no demo email can ever reach a real person.
 */
import type { SourceGroup } from '../analytics/self-reported.js';

export type Lang = 'hy' | 'en' | 'ru';

/** [native spelling, Latin spelling] */
type Name = readonly [string, string];

export const HY_FIRST: Name[] = [
  ['Անի', 'Ani'], ['Արամ', 'Aram'], ['Նարե', 'Nare'], ['Դավիթ', 'Davit'], ['Լիլիթ', 'Lilit'], ['Գոռ', 'Gor'],
  ['Մարիամ', 'Mariam'], ['Տիգրան', 'Tigran'], ['Անահիտ', 'Anahit'], ['Հայկ', 'Hayk'], ['Սոնա', 'Sona'], ['Արման', 'Arman'],
  ['Էլեն', 'Elen'], ['Վահե', 'Vahe'], ['Մանե', 'Mane'], ['Սամվել', 'Samvel'], ['Լուսինե', 'Lusine'], ['Արթուր', 'Artur'],
  ['Գայանե', 'Gayane'], ['Կարեն', 'Karen'], ['Նունե', 'Nune'], ['Էրիկ', 'Erik'], ['Շուշան', 'Shushan'], ['Ռուբեն', 'Ruben'],
  ['Աստղիկ', 'Astghik'], ['Հրանտ', 'Hrant'], ['Հասմիկ', 'Hasmik'], ['Լևոն', 'Levon'], ['Արմինե', 'Armine'], ['Սարգիս', 'Sargis'],
  ['Տաթևիկ', 'Tatevik'], ['Վարդան', 'Vardan'], ['Սիրանուշ', 'Siranush'], ['Հովհաննես', 'Hovhannes'], ['Մերի', 'Meri'], ['Գրիգոր', 'Grigor'],
  ['Ռուզաննա', 'Ruzanna'], ['Էդգար', 'Edgar'], ['Քնարիկ', 'Knarik'], ['Սմբատ', 'Smbat'],
];

export const HY_LAST: Name[] = [
  ['Սարգսյան', 'Sargsyan'], ['Հակոբյան', 'Hakobyan'], ['Պետրոսյան', 'Petrosyan'], ['Գրիգորյան', 'Grigoryan'],
  ['Մկրտչյան', 'Mkrtchyan'], ['Հովհաննիսյան', 'Hovhannisyan'], ['Ավետիսյան', 'Avetisyan'], ['Կարապետյան', 'Karapetyan'],
  ['Խաչատրյան', 'Khachatryan'], ['Մանուկյան', 'Manukyan'], ['Առաքելյան', 'Arakelyan'], ['Վարդանյան', 'Vardanyan'],
  ['Ղազարյան', 'Ghazaryan'], ['Բաղդասարյան', 'Baghdasaryan'], ['Սիմոնյան', 'Simonyan'], ['Ստեփանյան', 'Stepanyan'],
  ['Հարությունյան', 'Harutyunyan'], ['Մարտիրոսյան', 'Martirosyan'], ['Աբրահամյան', 'Abrahamyan'], ['Դանիելյան', 'Danielyan'],
  ['Ասատրյան', 'Asatryan'], ['Գալստյան', 'Galstyan'], ['Սահակյան', 'Sahakyan'], ['Միրզոյան', 'Mirzoyan'],
  ['Ավագյան', 'Avagyan'], ['Եղիազարյան', 'Yeghiazaryan'], ['Թադևոսյան', 'Tadevosyan'], ['Զաքարյան', 'Zakaryan'],
  ['Մելքոնյան', 'Melkonyan'], ['Գևորգյան', 'Gevorgyan'], ['Մովսիսյան', 'Movsisyan'], ['Մինասյան', 'Minasyan'],
];

/** [native, Latin, f | m]: Russian surnames follow the gender of the first name. */
export const RU_FIRST: (readonly [string, string, 'f' | 'm'])[] = [
  ['Анна', 'Anna', 'f'], ['Иван', 'Ivan', 'm'], ['Мария', 'Maria', 'f'], ['Алексей', 'Alexey', 'm'], ['Екатерина', 'Ekaterina', 'f'],
  ['Дмитрий', 'Dmitry', 'm'], ['Ольга', 'Olga', 'f'], ['Сергей', 'Sergey', 'm'], ['Наталья', 'Natalia', 'f'], ['Михаил', 'Mikhail', 'm'],
  ['Елена', 'Elena', 'f'], ['Андрей', 'Andrey', 'm'], ['Ксения', 'Ksenia', 'f'], ['Павел', 'Pavel', 'm'], ['Дарья', 'Daria', 'f'], ['Никита', 'Nikita', 'm'],
  ['Татьяна', 'Tatiana', 'f'], ['Артём', 'Artem', 'm'], ['Юлия', 'Yulia', 'f'], ['Роман', 'Roman', 'm'], ['Светлана', 'Svetlana', 'f'], ['Кирилл', 'Kirill', 'm'],
  ['Ирина', 'Irina', 'f'], ['Максим', 'Maxim', 'm'], ['Полина', 'Polina', 'f'], ['Егор', 'Egor', 'm'], ['Виктория', 'Viktoria', 'f'], ['Денис', 'Denis', 'm'],
  ['Алина', 'Alina', 'f'], ['Илья', 'Ilya', 'm'], ['София', 'Sofia', 'f'], ['Владимир', 'Vladimir', 'm'],
];

/** [masculine, feminine, Latin masculine] */
export const RU_LAST: (readonly [string, string, string])[] = [
  ['Иванов', 'Иванова', 'Ivanov'], ['Петров', 'Петрова', 'Petrov'], ['Смирнов', 'Смирнова', 'Smirnov'], ['Кузнецов', 'Кузнецова', 'Kuznetsov'],
  ['Попов', 'Попова', 'Popov'], ['Волков', 'Волкова', 'Volkov'], ['Соколов', 'Соколова', 'Sokolov'], ['Лебедев', 'Лебедева', 'Lebedev'],
  ['Козлов', 'Козлова', 'Kozlov'], ['Новиков', 'Новикова', 'Novikov'], ['Морозов', 'Морозова', 'Morozov'], ['Орлов', 'Орлова', 'Orlov'],
  ['Фёдоров', 'Фёдорова', 'Fedorov'], ['Михайлов', 'Михайлова', 'Mikhailov'], ['Белов', 'Белова', 'Belov'], ['Тарасов', 'Тарасова', 'Tarasov'],
  ['Зайцев', 'Зайцева', 'Zaitsev'], ['Павлов', 'Павлова', 'Pavlov'], ['Семёнов', 'Семёнова', 'Semenov'], ['Голубев', 'Голубева', 'Golubev'],
  ['Виноградов', 'Виноградова', 'Vinogradov'], ['Богданов', 'Богданова', 'Bogdanov'], ['Воробьёв', 'Воробьёва', 'Vorobyov'], ['Фролов', 'Фролова', 'Frolov'],
];

export const EN_FIRST = [
  'Emma', 'Liam', 'Olivia', 'Noah', 'Sophia', 'Lucas', 'Mia', 'Ethan', 'Chloe', 'Daniel', 'Grace', 'Leo', 'Hannah', 'Samuel', 'Zoe', 'Adam',
  'Isla', 'Oscar', 'Ruby', 'Felix', 'Alice', 'Henry', 'Clara', 'Jacob', 'Freya', 'Thomas', 'Ivy', 'Owen', 'Nora', 'Julian',
];
export const EN_LAST = [
  'Carter', 'Bennett', 'Hughes', 'Foster', 'Morgan', 'Reed', 'Hayes', 'Ellis', 'Brooks', 'Turner', 'Parker', 'Collins',
  'Fletcher', 'Lawson', 'Whitaker', 'Sullivan', 'Barnes', 'Holloway', 'Pearson', 'Quinn', 'Spencer', 'Wallace', 'Marsh', 'Doyle',
];

/** Reserved example domains only. */
export const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example.test', 'inbox.example.test'];

/**
 * "How did you hear about us?" answers per group and language, written so the keyword rules of
 * analytics/self-reported.ts recognise them.
 */
export const SELF_REPORTED: Record<SourceGroup, Record<Lang, string[]>> = {
  social: { en: ['Instagram ad', 'Saw a post on Facebook'], ru: ['Увидел рекламу в инстаграме', 'Telegram-канал'], hy: ['Տեսա ինստագրամում', 'Տեսա ֆեյսբուքում'] },
  search_website: { en: ['Google search', 'Found the website'], ru: ['Искал в гугле', 'Нашёл сайт'], hy: ['Որոնեցի գուգլում', 'Գտա կայքը'] },
  email: { en: ['The newsletter'], ru: ['Через рассылку'], hy: ['Ստացա տեղեկագիրը'] },
  events: { en: ['Open day', 'A workshop'], ru: ['Пришёл на день открытых дверей', 'Ходил на воркшоп'], hy: ['Եկա բաց դռների օրվան'] },
  referrals: { en: ['A friend told me', 'An alumnus recommended it'], ru: ['Посоветовал друг', 'Рекомендовал выпускник'], hy: ['Խորհուրդ տվեց ընկերս', 'Խորհուրդ տվեց շրջանավարտը'] },
  chatbot: { en: ['Chatbot on the website'], ru: ['Через чат-бот'], hy: ['Գրեցի չաթբոտին'] },
  partners_press: { en: ['University partner', 'An article in the news'], ru: ['Узнал в университете', 'Прочитал статью в новостях'], hy: ['Իմացա համալսարանից', 'Կարդացի լրատվական հոդված'] },
};

export const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  hy: ['հունվար', 'փետրվար', 'մարտ', 'ապրիլ', 'մայիս', 'հունիս', 'հուլիս', 'օգոստոս', 'սեպտեմբեր', 'հոկտեմբեր', 'նոյեմբեր', 'դեկտեմբեր'],
};

export const COURSES = [
  { id: 'course-frontend', prefix: 'fe', title: 'Frontend Development', weight: 26 },
  { id: 'course-backend', prefix: 'be', title: 'Backend Development', weight: 18 },
  { id: 'course-data', prefix: 'da', title: 'Data Analytics', weight: 20 },
  { id: 'course-ux', prefix: 'ux', title: 'UX/UI Design', weight: 16 },
  { id: 'course-python', prefix: 'py', title: 'Python Backend', weight: 12 },
  { id: 'course-qa', prefix: 'qa', title: 'QA Automation', weight: 8 },
] as const;

export type EventType = 'open_day' | 'workshop' | 'info_session' | 'meetup' | 'graduation';

/** Event programme by type: title, language, public, hour (Yerevan). */
export const EVENT_KINDS: Record<EventType, { titles: string[]; language: Lang; public: boolean; hour: number }> = {
  open_day: { titles: ['Open day: meet the mentors', 'Open day: autumn intake', 'Open day: spring intake'], language: 'hy', public: true, hour: 18 },
  workshop: { titles: ['Workshop: your first React app', 'Workshop: SQL for analysts', 'Workshop: Figma basics', 'Workshop: testing with Playwright'], language: 'en', public: true, hour: 19 },
  info_session: { titles: ['Info session: Data Analytics course', 'Info session: how admissions work', 'Info session: Python Backend'], language: 'ru', public: true, hour: 19 },
  meetup: { titles: ['Alumni meetup: careers in tech', 'Alumni meetup: from bootcamp to team lead'], language: 'en', public: true, hour: 19 },
  graduation: { titles: ['Graduation: Frontend and UX groups', 'Graduation: Data and Backend groups'], language: 'hy', public: false, hour: 15 },
};

/** Newsletter issue copy (NWS-05 block types); {month} is replaced by the edition month. */
export const NEWSLETTER: Record<Lang, { subject: string; preheader: string; lead: [string, string]; upcoming: string; recent: string; hires: [string, string]; cta: [string, string, string] }> = {
  en: {
    subject: 'Picsart Academy in {month}: open day, new groups and alumni stories',
    preheader: 'Two events to join, a new Data Analytics group and where our graduates work now.',
    lead: ['What happened in {month}', 'A busy month: two groups graduated, a new Data Analytics group opened and our alumni met at the careers meetup. Here is what is coming next.'],
    upcoming: 'Coming up',
    recent: 'In case you missed it',
    hires: ['Where our graduates work', '**Three graduates** of the spring Frontend group joined product teams this month. [Read their stories](https://academy.example.test/stories)'],
    cta: ['Applications are open', 'The next groups start soon and seats are limited.', 'Apply now'],
  },
  hy: {
    subject: 'Picsart Academy-ն {month}-ին. բաց դռների օր, նոր խմբեր և շրջանավարտների պատմություններ',
    preheader: 'Երկու միջոցառում, նոր Data Analytics խումբ և որտեղ են աշխատում մեր շրջանավարտները։',
    lead: ['Ինչ եղավ {month}-ին', 'Հագեցած ամիս էր. երկու խումբ ավարտեց, բացվեց նոր Data Analytics խումբ, իսկ շրջանավարտները հանդիպեցին կարիերայի միջոցառմանը։'],
    upcoming: 'Առաջիկա միջոցառումներ',
    recent: 'Եթե բաց եք թողել',
    hires: ['Որտեղ են աշխատում մեր շրջանավարտները', 'Գարնանային Frontend խմբի **երեք շրջանավարտ** այս ամիս միացան արտադրանքի թիմերին։ [Կարդալ պատմությունները](https://academy.example.test/stories)'],
    cta: ['Ընդունելությունը բաց է', 'Հաջորդ խմբերը շուտով մեկնարկում են, տեղերը սահմանափակ են։', 'Դիմել հիմա'],
  },
  ru: {
    subject: 'Picsart Academy, {month}: день открытых дверей, новые группы и истории выпускников',
    preheader: 'Два события, новая группа Data Analytics и где сейчас работают наши выпускники.',
    lead: ['Что произошло в этом месяце', 'Насыщенный месяц: выпустились две группы, открылась новая группа Data Analytics, а выпускники встретились на карьерном митапе.'],
    upcoming: 'Ближайшие события',
    recent: 'Если вы пропустили',
    hires: ['Где работают наши выпускники', '**Трое выпускников** весенней группы Frontend в этом месяце присоединились к продуктовым командам. [Читать истории](https://academy.example.test/stories)'],
    cta: ['Набор открыт', 'Следующие группы стартуют скоро, количество мест ограничено.', 'Подать заявку'],
  },
};
