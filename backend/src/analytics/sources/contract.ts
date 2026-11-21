/**
 * External analytics sources (PRD 9.1), as Marketing Hub consumes them. Each client returns one day per row
 * for an inclusive date range (YYYY-MM-DD, Yerevan dates) plus the raw response, which the pipeline stores
 * unchanged (9.2, RawRecord in 12.3). Real clients need the accounts and keys of manual task 3; until then
 * the mocks below return deterministic data, so re-running a range gives identical rows (ANL-02).
 */
export type DateRange = { from: string; to: string };

export type Pulled<Row> = { rows: Row[]; raw: unknown; endpoint: string };

/** Website analytics (for example the GA4 Data API): sessions and form conversions by campaign parameters. */
export type WebTrafficRow = {
  date: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPage: string;
  sessions: number;
  conversions: number;
};

/** Social platforms (for example the Meta Graph API): account-level daily metrics. */
export type SocialRow = {
  date: string;
  platform: string;
  accountId: string;
  reach: number;
  engagement: number;
  followers: number;
  leadForms: number;
};

/** Ad platforms (Meta Ads, Google Ads): spend and results per campaign per day, in the account currency. */
export type AdSpendRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  /** utm_campaign the ads link to, when the platform reports it; joins spend to touchpoints. */
  utmCampaign: string | null;
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  leads: number;
};

export interface WebAnalyticsClient {
  readonly name: string;
  dailyTraffic(range: DateRange): Promise<Pulled<WebTrafficRow>>;
  /** Rows from a stored raw response (rebuilds after a logic change, 9.2). */
  parse(raw: unknown): WebTrafficRow[];
}

export interface SocialClient {
  readonly name: string;
  dailyMetrics(range: DateRange): Promise<Pulled<SocialRow>>;
  parse(raw: unknown): SocialRow[];
}

export interface AdPlatformClient {
  /** meta_ads | google_ads */
  readonly name: string;
  dailyCampaigns(range: DateRange): Promise<Pulled<AdSpendRow>>;
  parse(raw: unknown): AdSpendRow[];
}

/** Central Bank of Armenia official rates (9.2: costs in other currencies are converted on the spend date). */
export interface ExchangeRateClient {
  /** AMD for one unit of the currency on that date (the last published rate on or before it). */
  rateToAmd(currency: string, date: string): Promise<number>;
}

export type AnalyticsSources = {
  web: WebAnalyticsClient;
  social: SocialClient[];
  ads: AdPlatformClient[];
  rates: ExchangeRateClient;
};
