/**
 * Locale-aware formatting (PRD 14.5): numbers, percentages, dates and AMD currency
 * follow the reader's language. Staff UI: en, hy; public pages: hy, en, ru.
 */
export type AppLocale = 'en' | 'hy' | 'ru';

const INTL_LOCALE: Record<AppLocale, string> = { en: 'en-GB', hy: 'hy-AM', ru: 'ru-RU' };

export const DEFAULT_LOCALE: AppLocale = 'en';

function intlLocale(locale: string | undefined): string {
  return INTL_LOCALE[(locale ?? DEFAULT_LOCALE) as AppLocale] ?? locale ?? INTL_LOCALE.en;
}

export function formatNumber(value: number, locale?: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** 0.124 → "12.4%". */
export function formatPercent(value: number, locale?: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

/** Amounts are stored in AMD (PRD 9.5); shown without decimals. */
export function formatAmd(value: number, locale?: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'AMD',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Dates follow the page language (`<html lang>`, set by the language switcher) unless a locale is given. */
export function formatDate(value: Date | string, locale?: string, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const pageLocale = locale ?? (typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined);
  return new Intl.DateTimeFormat(intlLocale(pageLocale), { dateStyle: 'medium', ...options }).format(date);
}

/** Text shown instead of a count of 1 or 2 people in views shared outside marketing (ANL-14, NFR-P5). */
export const SMALL_NUMBER_TEXT = 'fewer than 3';

/** Returns null when the count must be suppressed, otherwise the formatted count. */
export function suppressSmall(count: number, locale?: string): string | null {
  return count > 0 && count < 3 ? null : formatNumber(count, locale);
}
