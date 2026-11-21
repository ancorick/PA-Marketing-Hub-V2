import { createHash } from 'node:crypto';
import type { AdPlatformClient, AdSpendRow, AnalyticsSources, DateRange, ExchangeRateClient, Pulled, SocialClient, SocialRow, WebAnalyticsClient, WebTrafficRow } from './contract.js';

/** Inclusive list of YYYY-MM-DD dates. */
export function datesIn({ from, to }: DateRange): string[] {
  const dates: string[] = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day = new Date(day.getTime() + 86_400_000)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/** Stable pseudo-random integer in [min, max] for a key: the same date always gives the same numbers. */
function stable(key: string, min: number, max: number) {
  const value = createHash('sha256').update(key).digest().readUInt32BE(0);
  return min + (value % (max - min + 1));
}

const WEB_DIMENSIONS: Omit<WebTrafficRow, 'date' | 'sessions' | 'conversions'>[] = [
  { utmSource: 'instagram', utmMedium: 'paid_social', utmCampaign: 'autumn-intake', landingPage: '/courses/frontend' },
  { utmSource: 'instagram', utmMedium: 'social', utmCampaign: null, landingPage: '/' },
  { utmSource: 'google', utmMedium: 'organic', utmCampaign: null, landingPage: '/courses' },
  { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'brand-search', landingPage: '/courses/data' },
  { utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'monthly', landingPage: '/events' },
  { utmSource: null, utmMedium: null, utmCampaign: null, landingPage: '/' },
  // Not in the taxonomy: lands in the unmapped review queue (ANL-03).
  { utmSource: 'tiktok', utmMedium: 'influencer', utmCampaign: 'creator-test', landingPage: '/courses/design' },
];

export class MockWebAnalyticsClient implements WebAnalyticsClient {
  readonly name = 'website_analytics';
  failNext = 0;

  parse(raw: unknown): WebTrafficRow[] {
    return (raw as { rows: WebTrafficRow[] }).rows;
  }

  async dailyTraffic(range: DateRange): Promise<Pulled<WebTrafficRow>> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Website analytics API: 503 Service Unavailable');
    }
    const rows = datesIn(range).flatMap((date) =>
      WEB_DIMENSIONS.map((dims) => {
        const key = `${date}:${dims.utmSource}:${dims.utmMedium}:${dims.landingPage}`;
        const sessions = stable(key, 5, 120);
        return { date, ...dims, sessions, conversions: stable(`${key}:c`, 0, Math.max(1, Math.floor(sessions / 20))) };
      }),
    );
    return { rows, raw: { dimensionHeaders: ['date', 'sessionSource', 'sessionMedium', 'sessionCampaignName', 'landingPage'], rows }, endpoint: 'properties/mock:runReport' };
  }
}

export class MockSocialClient implements SocialClient {
  readonly name = 'social_meta';
  failNext = 0;

  parse(raw: unknown): SocialRow[] {
    return (raw as { data: SocialRow[] }).data;
  }

  async dailyMetrics(range: DateRange): Promise<Pulled<SocialRow>> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Meta Graph API: (#4) Application request limit reached');
    }
    const rows = datesIn(range).flatMap((date) =>
      ['instagram', 'facebook'].map((platform) => ({
        date,
        platform,
        accountId: `${platform}-academy`,
        reach: stable(`${date}:${platform}:r`, 400, 6000),
        engagement: stable(`${date}:${platform}:e`, 20, 600),
        followers: 12_000 + stable(`${platform}`, 0, 3000) + Math.floor((Date.parse(date) - Date.parse('2026-01-01')) / 86_400_000) * 4,
        leadForms: stable(`${date}:${platform}:l`, 0, 4),
      })),
    );
    return { rows, raw: { data: rows }, endpoint: 'insights' };
  }
}

const CAMPAIGNS: Record<string, { id: string; name: string; utm: string; currency: string; spend: [number, number] }[]> = {
  meta_ads: [
    { id: 'meta-1001', name: 'Autumn intake: Instagram', utm: 'autumn-intake', currency: 'USD', spend: [15, 60] },
    { id: 'meta-1002', name: 'Open day reminder', utm: 'open-day', currency: 'USD', spend: [5, 25] },
  ],
  google_ads: [{ id: 'gads-77', name: 'Brand search', utm: 'brand-search', currency: 'AMD', spend: [4000, 16000] }],
};

export class MockAdPlatformClient implements AdPlatformClient {
  failNext = 0;
  constructor(readonly name: 'meta_ads' | 'google_ads') {}

  parse(raw: unknown): AdSpendRow[] {
    return (raw as { data: AdSpendRow[] }).data;
  }

  async dailyCampaigns(range: DateRange): Promise<Pulled<AdSpendRow>> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error(`${this.name}: 401 invalid access token`);
    }
    const rows = datesIn(range).flatMap((date) =>
      (CAMPAIGNS[this.name] ?? []).map((campaign) => {
        const clicks = stable(`${date}:${campaign.id}:k`, 10, 200);
        return {
          date,
          campaignId: campaign.id,
          campaignName: campaign.name,
          utmCampaign: campaign.utm,
          spend: stable(`${date}:${campaign.id}:s`, campaign.spend[0], campaign.spend[1]),
          currency: campaign.currency,
          impressions: clicks * stable(`${date}:${campaign.id}:i`, 20, 60),
          clicks,
          leads: stable(`${date}:${campaign.id}:l`, 0, 5),
        };
      }),
    );
    return { rows, raw: { data: rows }, endpoint: this.name === 'meta_ads' ? 'act_mock/insights' : 'customers/mock/googleAds:search' };
  }
}

/** Fixed rates close to the 2026 CBA levels; a real client reads cb.am (no key needed, manual task 3 lists it). */
export class MockExchangeRateClient implements ExchangeRateClient {
  static readonly RATES: Record<string, number> = { AMD: 1, USD: 387.5, EUR: 452.1, RUB: 4.8, GBP: 520.3 };

  async rateToAmd(currency: string): Promise<number> {
    const rate = MockExchangeRateClient.RATES[currency.toUpperCase()];
    if (!rate) throw new Error(`No Central Bank of Armenia rate for ${currency}`);
    return rate;
  }
}

export function createMockAnalyticsSources(): AnalyticsSources {
  return {
    web: new MockWebAnalyticsClient(),
    social: [new MockSocialClient()],
    ads: [new MockAdPlatformClient('meta_ads'), new MockAdPlatformClient('google_ads')],
    rates: new MockExchangeRateClient(),
  };
}
