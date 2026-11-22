import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { AppConfig } from '../config/env.js';
import type { AppPgDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { SegmentService } from '../segments/service.js';
import { DEMO_VERSION, generateDemoData, type DemoData } from './generate.js';

/** app_settings row that marks a database as holding the demo data set. */
export const DEMO_MARKER_KEY = 'demo_seed';

export type DemoSeedResult =
  | { status: 'seeded'; rows: Record<string, number> }
  | { status: 'skipped'; reason: string };

/** Insert order: every row's references exist before it. */
const ORDER: [keyof DemoData, PgTable][] = [
  ['sendingDomains', schema.sendingDomains],
  ['contactImports', schema.contactImports],
  ['contacts', schema.contacts],
  ['consentRecords', schema.consentRecords],
  ['suppressions', schema.suppressions],
  ['touchpoints', schema.touchpoints],
  ['outcomes', schema.outcomes],
  ['events', schema.events],
  ['eventRegistrations', schema.eventRegistrations],
  ['segments', schema.segments],
  ['segmentMembers', schema.segmentMembers],
  ['manualCosts', schema.manualCosts],
  ['adSpendDaily', schema.adSpendDaily],
  ['webTrafficDaily', schema.webTrafficDaily],
  ['socialDaily', schema.socialDaily],
  ['newsletterTemplates', schema.newsletterTemplates],
  ['newsletterCadences', schema.newsletterCadences],
  ['collectedItems', schema.collectedItems],
  ['issues', schema.issues],
  ['issueBlocks', schema.issueBlocks],
  ['issueEdits', schema.issueEdits],
  ['issueComments', schema.issueComments],
  ['sends', schema.sends],
  ['deliveries', schema.deliveries],
  ['linkClicks', schema.linkClicks],
  ['dmarcReports', schema.dmarcReports],
  ['dmarcRecords', schema.dmarcRecords],
  ['channelRules', schema.channelRules],
  ['unmappedValues', schema.unmappedValues],
  ['trackedLinks', schema.trackedLinks],
  ['marketingCampaigns', schema.marketingCampaigns],
  ['syncRuns', schema.syncRuns],
  ['alerts', schema.alerts],
  ['auditEvents', schema.auditEvents],
  ['exportLog', schema.exportLog],
  ['staffActivity', schema.staffActivity],
  ['appSettings', schema.appSettings],
];

/** Postgres allows 65,535 parameters per statement. */
const MAX_PARAMETERS = 60_000;

/**
 * Loads the synthetic demo data set (docs/RESTRUCTURE.md R2) when DEMO_SEED=true. Refuses production outright
 * and only ever writes into a database without contacts, so it can never mix with real data; a database that
 * already holds the demo set is left alone, which makes a restart against a persistent database a no-op.
 */
export async function seedDemoData(db: AppPgDatabase, options: { nodeEnv: AppConfig['nodeEnv']; demoMode?: boolean; now?: Date }): Promise<DemoSeedResult> {
  if (options.nodeEnv === 'production' && !options.demoMode) throw new Error('Demo data is never loaded in production (DEMO_SEED)');
  const [marker] = await db.select({ key: schema.appSettings.key }).from(schema.appSettings).where(eq(schema.appSettings.key, DEMO_MARKER_KEY));
  if (marker) return { status: 'skipped', reason: 'the demo data set is already loaded' };
  const [existing] = await db.select({ value: count() }).from(schema.contacts);
  if ((existing?.value ?? 0) > 0) return { status: 'skipped', reason: 'the database already has contacts; demo data only goes into an empty database' };

  const now = options.now ?? new Date();
  const data = generateDemoData({ now });
  const rows: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const [name, table] of ORDER) {
      const items = data[name] as Record<string, unknown>[];
      rows[name] = items.length;
      if (items.length === 0) continue;
      const columns = Math.max(...items.slice(0, 50).map((item) => Object.keys(item).length));
      const size = Math.max(1, Math.floor(MAX_PARAMETERS / Math.max(columns, 1)));
      for (let i = 0; i < items.length; i += size) await tx.insert(table).values(items.slice(i, i + size) as never);
    }
    await tx.insert(schema.appSettings).values({ key: DEMO_MARKER_KEY, value: { version: DEMO_VERSION, seededAt: now.toISOString() }, updatedBy: 'demo-seed' });
  });

  // Member counts for the segment list, computed by the same rules as the app (AUD-14).
  const segments = new SegmentService(db);
  for (const segment of data.segments) {
    if (segment.type !== 'dynamic') continue;
    const value = await segments.countRule(segment.rule);
    await db.update(schema.segments).set({ lastCount: value, lastCountedAt: now }).where(eq(schema.segments.id, segment.id as string));
  }
  return { status: 'seeded', rows };
}
