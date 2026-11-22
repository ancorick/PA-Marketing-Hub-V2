import { useSyncExternalStore } from 'react';
import { MEASURE_STRINGS } from './strings/measure';
import { REACH_STRINGS } from './strings/reach';
import { SEND_STRINGS } from './strings/send';
import { LEGACY_STRINGS } from './strings/legacy';

/**
 * Staff interface language (RESTRUCTURE §3–4): the shell and the new analytics components speak Armenian,
 * English and Russian. Page texts written before the restructure stay as they are until their step rewrites them.
 */
export type StaffLang = 'hy' | 'en' | 'ru';

export const STAFF_LANGS: { value: StaffLang; label: string }[] = [
  { value: 'hy', label: 'Հայերեն' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

const SHELL_STRINGS = {
  // Navigation groups and items (RESTRUCTURE §3).
  'group.measure': { en: 'Measure', hy: 'Չափում', ru: 'Измерение' },
  'group.reach': { en: 'Reach', hy: 'Լսարան', ru: 'Охват' },
  'group.send': { en: 'Send', hy: 'Ուղարկում', ru: 'Отправка' },
  'group.settings': { en: 'Settings', hy: 'Կարգավորումներ', ru: 'Настройки' },
  'nav.overview': { en: 'Overview', hy: 'Ամփոփում', ru: 'Обзор' },
  'nav.cohorts': { en: 'Cohorts', hy: 'Կոհորտներ', ru: 'Когорты' },
  'nav.costs': { en: 'Costs', hy: 'Ծախսեր', ru: 'Затраты' },
  'nav.campaignsLinks': { en: 'Campaigns & links', hy: 'Արշավներ և հղումներ', ru: 'Кампании и ссылки' },
  'nav.dataHealth': { en: 'Data health', hy: 'Տվյալների վիճակ', ru: 'Состояние данных' },
  'nav.contacts': { en: 'Contacts', hy: 'Կոնտակտներ', ru: 'Контакты' },
  'nav.segments': { en: 'Segments', hy: 'Սեգմենտներ', ru: 'Сегменты' },
  'nav.audienceHealth': { en: 'Audience health', hy: 'Լսարանի վիճակ', ru: 'Состояние аудитории' },
  'nav.events': { en: 'Events', hy: 'Միջոցառումներ', ru: 'События' },
  'nav.newsletter': { en: 'Newsletter', hy: 'Տեղեկագիր', ru: 'Рассылка' },
  'nav.campaignEmails': { en: 'Campaign emails', hy: 'Արշավային նամակներ', ru: 'Письма кампаний' },
  'nav.devInbox': { en: 'Dev inbox', hy: 'Փորձնական փոստարկղ', ru: 'Тестовые письма' },
  'nav.emailSettings': { en: 'Email settings', hy: 'Էլփոստի կարգավորումներ', ru: 'Настройки почты' },
  'nav.alerts': { en: 'Alerts', hy: 'Ծանուցումներ', ru: 'Оповещения' },
  'nav.admin': { en: 'Admin', hy: 'Ադմին', ru: 'Админ' },
  // Shell.
  'shell.main': { en: 'Main', hy: 'Գլխավոր', ru: 'Основное' },
  'shell.skip': { en: 'Skip to main content', hy: 'Անցնել հիմնական բովանդակությանը', ru: 'Перейти к содержимому' },
  'shell.openMenu': { en: 'Open menu', hy: 'Բացել ընտրացանկը', ru: 'Открыть меню' },
  'shell.closeMenu': { en: 'Close menu', hy: 'Փակել ընտրացանկը', ru: 'Закрыть меню' },
  'shell.collapse': { en: 'Collapse sidebar', hy: 'Ծալել կողային վահանակը', ru: 'Свернуть панель' },
  'shell.expand': { en: 'Expand sidebar', hy: 'Բացել կողային վահանակը', ru: 'Развернуть панель' },
  'shell.signupForm': { en: 'Public sign-up form', hy: 'Գրանցման հանրային ձև', ru: 'Публичная форма подписки' },
  'shell.archive': { en: 'Newsletter archive', hy: 'Տեղեկագրի արխիվ', ru: 'Архив рассылки' },
  'shell.opensNewTab': { en: 'opens in a new tab', hy: 'բացվում է նոր ներդիրում', ru: 'откроется в новой вкладке' },
  'shell.role': { en: 'Role (mock sign-in)', hy: 'Դեր (փորձնական մուտք)', ru: 'Роль (тестовый вход)' },
  'shell.staff': { en: 'Signed in as', hy: 'Մուտք է գործել որպես', ru: 'Вход выполнен как' },
  'shell.language': { en: 'Language', hy: 'Լեզու', ru: 'Язык' },
  'shell.theme': { en: 'Theme', hy: 'Թեմա', ru: 'Тема' },
  'shell.demo': { en: 'Demo', hy: 'Դեմո', ru: 'Демо' },
  'shell.demoData': { en: 'synthetic data', hy: 'հորինված տվյալներ', ru: 'вымышленные данные' },
  'shell.demoHint': {
    en: 'A demo site: every contact, campaign and number is made up, and no email is sent.',
    hy: 'Ցուցադրական կայք է. բոլոր կոնտակտները, արշավները և թվերը հորինված են, նամակներ չեն ուղարկվում։',
    ru: 'Демо-сайт: все контакты, кампании и цифры вымышлены, письма не отправляются.',
  },
  'shell.signOut': { en: 'Sign out', hy: 'Դուրս գալ', ru: 'Выйти' },
  'shell.signOutLater': {
    en: 'Sign-out arrives with the Core Engine sign-in; until then the role switch stands in for it.',
    hy: 'Ելքը հասանելի կլինի Core Engine մուտքի հետ․ մինչ այդ դերը փոխվում է վերևի ընտրիչով։',
    ru: 'Выход появится вместе со входом через Core Engine; пока его заменяет переключатель роли.',
  },
  'shell.unread': { en: 'unresolved', hy: 'չլուծված', ru: 'не решено' },
  'shell.pageError': { en: 'This page could not be shown', hy: 'Այս էջը հնարավոր չեղավ ցույց տալ', ru: 'Эту страницу не удалось показать' },
  'shell.pageErrorHint': {
    en: 'The rest of the app still works. Reload the page; if it happens again, tell the team what you did. Details:',
    hy: 'Հավելվածի մնացած մասն աշխատում է։ Վերաբեռնեք էջը․ եթե կրկնվի, պատմեք թիմին, թե ինչ արեցիք։ Մանրամասներ՝',
    ru: 'Остальное приложение работает. Перезагрузите страницу; если ошибка повторится, расскажите команде, что вы делали. Подробности:',
  },
  'shell.reload': { en: 'Reload the page', hy: 'Վերաբեռնել էջը', ru: 'Перезагрузить страницу' },
  'shell.devOnly': { en: 'Development and demo only', hy: 'Միայն մշակման և ցուցադրման համար', ru: 'Только для разработки и демо' },
  // Filters (RESTRUCTURE §4).
  'filter.period': { en: 'Period', hy: 'Ժամանակահատված', ru: 'Период' },
  'filter.30d': { en: '30 days', hy: '30 օր', ru: '30 дней' },
  'filter.90d': { en: '90 days', hy: '90 օր', ru: '90 дней' },
  'filter.lastQuarter': { en: 'Last quarter', hy: 'Նախորդ եռամսյակ', ru: 'Прошлый квартал' },
  'filter.thisYear': { en: 'This year', hy: 'Այս տարի', ru: 'Этот год' },
  'filter.12m': { en: '12 months', hy: '12 ամիս', ru: '12 месяцев' },
  'filter.custom': { en: 'Custom', hy: 'Այլ', ru: 'Свой' },
  'filter.from': { en: 'From', hy: 'Սկսած', ru: 'С' },
  'filter.to': { en: 'To', hy: 'Մինչև', ru: 'По' },
  'filter.attribution': { en: 'Attribution', hy: 'Վերագրում', ru: 'Атрибуция' },
  'filter.firstTouch': { en: 'First touch', hy: 'Առաջին շփում', ru: 'Первое касание' },
  'filter.lastTouch': { en: 'Last touch before application', hy: 'Վերջին շփում մինչև դիմումը', ru: 'Последнее касание до заявки' },
  'filter.positionBased': { en: 'Position-based 40/20/40', hy: 'Դիրքային 40/20/40', ru: 'По позициям 40/20/40' },
  'filter.view': { en: 'View', hy: 'Տեսք', ru: 'Вид' },
  'filter.viewPeriod': { en: 'Period', hy: 'Ժամանակահատված', ru: 'Период' },
  'filter.viewCohort': { en: 'Cohort', hy: 'Կոհորտ', ru: 'Когорта' },
  'filter.viewHint': {
    en: 'Period: what happened in these dates. Cohort: what happened to people first reached in these dates.',
    hy: 'Ժամանակահատված՝ ինչ է եղել այս օրերին։ Կոհորտ՝ ինչ է եղել այս օրերին առաջին անգամ հասած մարդկանց հետ։',
    ru: 'Период: что произошло в эти даты. Когорта: что произошло с людьми, впервые пришедшими в эти даты.',
  },
  // Charts and tables.
  'chart.chart': { en: 'Chart', hy: 'Գծապատկեր', ru: 'График' },
  'chart.table': { en: 'Table', hy: 'Աղյուսակ', ru: 'Таблица' },
  'chart.show': { en: 'Show as', hy: 'Ցույց տալ որպես', ru: 'Показать как' },
  'chart.noData': { en: 'No data for this period yet.', hy: 'Այս ժամանակահատվածի համար տվյալներ դեռ չկան։', ru: 'Данных за этот период пока нет.' },
  'chart.ofPrevious': { en: 'of the previous step', hy: 'նախորդ քայլից', ru: 'от предыдущего шага' },
  'table.total': { en: 'Total', hy: 'Ընդամենը', ru: 'Итого' },
  'table.download': { en: 'Download CSV', hy: 'Ներբեռնել CSV', ru: 'Скачать CSV' },
  'tip.definitionOf': { en: 'Definition of {name}', hy: 'Սահմանում՝ {name}', ru: 'Определение: {name}' },
  'tile.seeData': { en: 'See data', hy: 'Տվյալները', ru: 'Данные' },
  'tile.seeDataFor': { en: 'for {name}', hy: '«{name}»-ի համար', ru: 'по показателю «{name}»' },
  'tile.up': { en: 'up', hy: 'աճ', ru: 'рост' },
  'tile.down': { en: 'down', hy: 'անկում', ru: 'снижение' },
  'tile.noChange': { en: 'no change', hy: 'առանց փոփոխության', ru: 'без изменений' },
  'tile.vsPrevious': { en: 'vs previous period', hy: 'նախորդ ժամանակահատվածի համեմատ', ru: 'к прошлому периоду' },
  'tile.trend': { en: '{name}: trend', hy: '{name}՝ միտում', ru: '{name}: динамика' },
  'theme.group': { en: 'Color theme', hy: 'Գունային թեմա', ru: 'Цветовая тема' },
  'theme.dark': { en: 'Dark theme', hy: 'Մուգ թեմա', ru: 'Тёмная тема' },
  'theme.light': { en: 'Light theme', hy: 'Բաց թեմա', ru: 'Светлая тема' },
  'theme.system': { en: 'Match system theme', hy: 'Ինչպես համակարգում', ru: 'Как в системе' },
  'role.admin': { en: 'Admin', hy: 'Ադմինիստրատոր', ru: 'Администратор' },
  'role.marketing_manager': { en: 'Marketing manager', hy: 'Մարքեթինգի մենեջեր', ru: 'Маркетинг-менеджер' },
  'role.editor': { en: 'Editor', hy: 'Խմբագիր', ru: 'Редактор' },
  'role.viewer': { en: 'Viewer', hy: 'Դիտորդ', ru: 'Наблюдатель' },
  'role.leadership': { en: 'Leadership', hy: 'Ղեկավարություն', ru: 'Руководство' },
  'copy.copied': { en: 'Copied', hy: 'Պատճենվեց', ru: 'Скопировано' },
  'copy.failed': {
    en: 'Copy failed: select the text and copy it manually',
    hy: 'Չհաջողվեց պատճենել. ընտրեք տեքստը և պատճենեք ձեռքով',
    ru: 'Не удалось скопировать: выделите текст и скопируйте вручную',
  },
  'chart.showTable': { en: 'Show data as a table', hy: 'Ցույց տալ տվյալները աղյուսակով', ru: 'Показать данные таблицей' },
  'chart.month': { en: 'Month', hy: 'Ամիս', ru: 'Месяц' },
  'table.previous': { en: 'Previous page', hy: 'Նախորդ էջ', ru: 'Предыдущая страница' },
  'table.next': { en: 'Next page', hy: 'Հաջորդ էջ', ru: 'Следующая страница' },
  'table.range': { en: '{from}–{to} of {total}', hy: '{from}–{to}՝ {total}-ից', ru: '{from}–{to} из {total}' },
  'dialog.close': { en: 'Close', hy: 'Փակել', ru: 'Закрыть' },
} as const satisfies Record<string, Record<StaffLang, string>>;

/** Shell and kit strings plus the pages rebuilt so far (R3: MEASURE, R4: REACH, R5: SEND and SETTINGS). */
const STRINGS = { ...SHELL_STRINGS, ...MEASURE_STRINGS, ...REACH_STRINGS, ...SEND_STRINGS, ...LEGACY_STRINGS } satisfies Record<string, Record<StaffLang, string>>;

export type StringKey = keyof typeof STRINGS;

const KEY = 'mh-lang';
const listeners = new Set<() => void>();
let memory: StaffLang = 'en';

function read(): StaffLang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'hy' || saved === 'en' || saved === 'ru') memory = saved;
  } catch {
    // storage blocked: keep the in-memory choice
  }
  return memory;
}

export function setStaffLang(lang: StaffLang) {
  memory = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // storage blocked
  }
  document.documentElement.lang = lang;
  listeners.forEach((listener) => listener());
}

export function useStaffLang(): StaffLang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => 'en' as const,
  );
}

/** Translate a shell or component string; `{name}` placeholders are filled from `values`. */
export function translate(lang: StaffLang, key: StringKey, values: Record<string, string | number> = {}) {
  return STRINGS[key][lang].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

export function useT() {
  const lang = useStaffLang();
  return (key: StringKey, values?: Record<string, string | number>) => translate(lang, key, values);
}
