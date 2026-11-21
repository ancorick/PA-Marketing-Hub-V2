import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyticsPipeline } from '../src/analytics/pipeline.js';
import { createMockAnalyticsSources, MockWebAnalyticsClient } from '../src/analytics/sources/mock.js';
import { adSpendDaily, rawRecords, socialDaily, webTrafficDaily } from '../src/db/schema.js';
import { JobRunner } from '../src/jobs/runner.js';
import { bearer, buildTestApp, currentTestDatabase, testDatabase } from './helpers.js';

const range = { from: '2026-10-01', to: '2026-10-07' };
const strip = <T extends Record<string, unknown>>(rows: T[]) => rows.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => rest);

describe('analytics pipeline (ANL-01, ANL-02)', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  async function setup() {
    const sources = createMockAnalyticsSources();
    const app = await buildTestApp({ analyticsSources: sources });
    close = () => app.close();
    return { app, sources, db: (await currentTestDatabase()).db };
  }

  it('stores the raw response with its window and pull time, then clean rows', async () => {
    const { app, db } = await setup();
    const result = await app.pipeline.pull('website_analytics', range);
    expect(result.rowsUpserted).toBe(7 * 7);
    const [raw] = await db.select().from(rawRecords);
    expect(raw).toMatchObject({ source: 'website_analytics', windowFrom: '2026-10-01', windowTo: '2026-10-07' });
    expect(raw?.pulledAt).toBeInstanceOf(Date);
    const rows = await db.select().from(webTrafficDaily).where(eq(webTrafficDaily.utmMedium, 'paid_social'));
    expect(rows).toHaveLength(7);
    expect(rows[0]?.channel).toBe('paid_social');
  });

  it('re-running any date range gives identical tables (idempotent upserts)', async () => {
    const { app, db } = await setup();
    for (const source of app.pipeline.sourceNames()) await app.pipeline.pull(source, range);
    const snapshot = async () => ({
      web: strip(await db.select().from(webTrafficDaily).orderBy(asc(webTrafficDaily.date), asc(webTrafficDaily.landingPage), asc(webTrafficDaily.utmSource))),
      social: strip(await db.select().from(socialDaily).orderBy(asc(socialDaily.date), asc(socialDaily.platform))),
      ads: strip(await db.select().from(adSpendDaily).orderBy(asc(adSpendDaily.date), asc(adSpendDaily.platformCampaignId))),
    });
    const first = await snapshot();
    // An overlapping re-run of part of the range, then the whole range again.
    for (const source of app.pipeline.sourceNames()) await app.pipeline.pull(source, { from: '2026-10-05', to: '2026-10-09' });
    for (const source of app.pipeline.sourceNames()) await app.pipeline.pull(source, range);
    const second = await snapshot();
    expect(second.web.filter((row) => row.date <= '2026-10-07')).toEqual(first.web);
    expect(second.ads.filter((row) => row.date <= '2026-10-07')).toEqual(first.ads);
    expect(second.social.filter((row) => row.date <= '2026-10-07')).toEqual(first.social);
  });

  it('converts spend to AMD at the CBA rate and keeps the original amount', async () => {
    const { app, db } = await setup();
    await app.pipeline.pull('meta_ads', { from: '2026-10-01', to: '2026-10-01' });
    const [row] = await db.select().from(adSpendDaily).where(eq(adSpendDaily.platformCampaignId, 'meta-1001'));
    expect(row).toMatchObject({ currency: 'USD', rateToAmd: '387.5', channel: 'paid_social', campaign: 'autumn-intake', origin: 'api' });
    expect(row?.amountAmd).toBe(Math.round(Number(row?.originalAmount) * 387.5));
  });

  it('rebuilds clean tables from stored raw data without calling the source', async () => {
    const { app, db, sources } = await setup();
    await app.pipeline.pull('website_analytics', range);
    const before = strip(await db.select().from(webTrafficDaily).orderBy(asc(webTrafficDaily.date), asc(webTrafficDaily.landingPage), asc(webTrafficDaily.utmSource)));
    await db.delete(webTrafficDaily);
    (sources.web as MockWebAnalyticsClient).failNext = 5;
    const response = await app.inject({ method: 'POST', url: '/api/analytics/pipeline/website_analytics/rerun', headers: bearer('admin'), payload: { ...range, mode: 'rebuild' } });
    expect(response.statusCode).toBe(200);
    const after = strip(await db.select().from(webTrafficDaily).orderBy(asc(webTrafficDaily.date), asc(webTrafficDaily.landingPage), asc(webTrafficDaily.utmSource)));
    expect(after).toEqual(before);
  });

  it('pulls incrementally: a three-day overlap after the last window, a 90-day backfill first', async () => {
    const { app } = await setup();
    const now = new Date('2026-11-21T23:00:00Z'); // 03:00 on 22 November in Yerevan
    expect(app.pipeline.windowRange(null, now)).toEqual({ from: '2026-08-24', to: '2026-11-21' });
    expect(app.pipeline.windowRange(new Date('2026-11-20T23:00:00Z'), now)).toEqual({ from: '2026-11-18', to: '2026-11-21' });
  });

  it('imports an ad platform CSV export as the fallback, and rejects the whole file on a bad row', async () => {
    const { app, db } = await setup();
    const csv = 'Date,Campaign ID,Campaign name,Spend,Currency,UTM campaign,Clicks\n2026-10-02,c-1,Open day,"12,50",EUR,open-day,40\n2026-10-03,c-1,Open day,10,EUR,open-day,\n';
    const ok = await app.inject({ method: 'POST', url: '/api/analytics/ad-spend/csv', headers: bearer('marketing_manager'), payload: { platform: 'meta_ads', csv } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ rowsUpserted: 2, range: { from: '2026-10-02', to: '2026-10-03' } });
    const rows = await db.select().from(adSpendDaily);
    expect(rows.map((row) => [row.origin, row.originalAmount, row.amountAmd])).toEqual([
      ['csv', '12.50', Math.round(12.5 * 452.1)],
      ['csv', '10.00', Math.round(10 * 452.1)],
    ]);
    const bad = await app.inject({ method: 'POST', url: '/api/analytics/ad-spend/csv', headers: bearer('marketing_manager'), payload: { platform: 'meta_ads', csv: 'date,campaign_id,campaign_name,spend,currency\n10/02/2026,c-2,X,5,USD\n2026-10-04,c-2,X,-1,USD\n' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().rows).toEqual([
      { line: 2, message: 'date must be YYYY-MM-DD' },
      { line: 3, message: 'spend must be a number ≥ 0' },
    ]);
    expect(await db.select().from(adSpendDaily)).toHaveLength(2);
    const editor = await app.inject({ method: 'POST', url: '/api/analytics/ad-spend/csv', headers: bearer('editor'), payload: { platform: 'meta_ads', csv } });
    expect(editor.statusCode).toBe(403);
  });

  it('only admins re-run sources; unknown sources are 404; a failing source answers 502', async () => {
    const { app, sources } = await setup();
    const asManager = await app.inject({ method: 'POST', url: '/api/analytics/pipeline/meta_ads/rerun', headers: bearer('marketing_manager'), payload: range });
    expect(asManager.statusCode).toBe(403);
    const unknown = await app.inject({ method: 'POST', url: '/api/analytics/pipeline/tiktok_ads/rerun', headers: bearer('admin'), payload: range });
    expect(unknown.statusCode).toBe(404);
    (sources.web as MockWebAnalyticsClient).failNext = 1;
    const failing = await app.inject({ method: 'POST', url: '/api/analytics/pipeline/website_analytics/rerun', headers: bearer('admin'), payload: range });
    expect(failing.statusCode).toBe(502);
  });

  it('deletes raw responses older than 13 months', async () => {
    const database = await testDatabase();
    const now = new Date('2026-11-21T12:00:00Z');
    const pipeline = new AnalyticsPipeline({ db: database.db, sources: createMockAnalyticsSources(), now: () => now });
    const old = { source: 'meta_ads', endpoint: 'x', windowFrom: '2025-09-01', windowTo: '2025-09-01', payload: { data: [] } };
    await database.db.insert(rawRecords).values([
      { ...old, pulledAt: new Date('2025-10-01T00:00:00Z') },
      { ...old, pulledAt: new Date('2025-11-01T00:00:00Z') },
    ]);
    expect(await pipeline.pruneRaw()).toEqual({ rowsIn: 1, rowsUpserted: 1 });
  });
});

describe('nightly schedule (NFR-F6)', () => {
  it('runs a daily job once per slot, including a slot missed while the process slept', async () => {
    const database = await testDatabase();
    let now = new Date('2026-11-21T22:59:00Z');
    let runs = 0;
    const runner = new JobRunner({ db: database.db, logger: { info: () => {}, error: () => {} }, now: () => now });
    runner.register({ name: 'nightly_test', description: 'x', intervalMs: 0, dailyAtUtc: '23:00', run: async () => ((runs += 1), { rowsIn: 0, rowsUpserted: 0 }) });
    await runner.runDueDaily(); // yesterday's slot was never run: catch up
    expect(runs).toBe(1);
    await runner.runDueDaily();
    expect(runs).toBe(1);
    now = new Date('2026-11-21T23:00:30Z');
    await runner.runDueDaily();
    await runner.runDueDaily();
    expect(runs).toBe(2);
    expect((await runner.status())[0]).toMatchObject({ dailyAtUtc: '23:00', intervalMinutes: 1440 });
  });
});
