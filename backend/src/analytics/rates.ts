import { eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import type { ExchangeRateClient } from './sources/contract.js';

/** Currencies with a stored rate; AMD is always 1. */
export const RATE_CURRENCIES = ['USD', 'EUR', 'RUB', 'GBP'] as const;

export type StoredRate = { date: string; currency: string; rateToAmd: number; enteredBy?: string };
type RatesSetting = { source: 'demo' | 'manual'; note?: string; rates: StoredRate[] };

const KEY = 'exchange_rates';

export class RateError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Exchange rates for costs in other currencies (PRD 9.2). Rates entered on the Costs page, or loaded with the
 * demo data set, are stored in app_settings and win for their currency from their date on; any other date or
 * currency falls back to the rate client (Central Bank of Armenia, mock until manual task 3).
 */
export class StoredExchangeRates implements ExchangeRateClient {
  private cache: { at: number; value: RatesSetting | null } | null = null;

  constructor(
    private readonly db: AppPgDatabase,
    private readonly fallback: ExchangeRateClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** AMD for one unit on that date: the latest stored rate on or before it, otherwise the fallback client. */
  async rateToAmd(currency: string, date: string): Promise<number> {
    const code = currency.toUpperCase();
    if (code === 'AMD') return 1;
    const stored = (await this.setting())?.rates
      .filter((rate) => rate.currency === code && rate.date <= date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return stored ? stored.rateToAmd : this.fallback.rateToAmd(code, date);
  }

  /** Stored rates (newest first) and the latest rate per currency, for the Costs page. */
  async list() {
    const setting = await this.setting();
    const rates = [...(setting?.rates ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));
    const latest = await Promise.all(
      RATE_CURRENCIES.map(async (currency) => {
        const own = rates.find((rate) => rate.currency === currency);
        if (own) return { ...own, origin: setting?.source === 'demo' && !own.enteredBy ? 'demo' : 'manual' };
        const today = this.now().toISOString().slice(0, 10);
        try {
          return { currency, date: today, rateToAmd: await this.fallback.rateToAmd(currency, today), origin: 'cba' };
        } catch {
          return null;
        }
      }),
    );
    return { source: setting?.source ?? null, note: setting?.note ?? null, latest: latest.filter((rate) => rate !== null), rates: rates.slice(0, 200) };
  }

  /** Saves the rate of one currency on one day (replacing a rate for the same day). */
  async save(input: { currency: string; date: string; rateToAmd: number }, actor: string) {
    const currency = input.currency.toUpperCase();
    if (!(RATE_CURRENCIES as readonly string[]).includes(currency)) throw new RateError('currency', 'Choose a currency');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) throw new RateError('date', 'Enter the date the rate applies from');
    if (!Number.isFinite(input.rateToAmd) || input.rateToAmd <= 0 || input.rateToAmd > 100_000) throw new RateError('rateToAmd', 'Enter the AMD amount for one unit, above zero');
    const current = (await this.setting()) ?? { source: 'manual' as const, rates: [] };
    const rate: StoredRate = { date: input.date, currency, rateToAmd: Math.round(input.rateToAmd * 10_000) / 10_000, enteredBy: actor };
    const value: RatesSetting = {
      ...current,
      rates: [...current.rates.filter((item) => !(item.currency === currency && item.date === input.date)), rate],
    };
    await this.db
      .insert(appSettings)
      .values({ key: KEY, value, updatedBy: actor })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor, updatedAt: this.now() } });
    this.cache = null;
    return rate;
  }

  /** Read at most once a minute: a CSV import converts every row. */
  private async setting(): Promise<RatesSetting | null> {
    const at = Date.now();
    if (this.cache && at - this.cache.at < 60_000) return this.cache.value;
    const [row] = await this.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
    const value = (row?.value as RatesSetting | undefined) ?? null;
    this.cache = { at, value };
    return value;
  }
}
