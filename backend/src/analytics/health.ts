import type { JobRunner, SyncRunView } from '../jobs/runner.js';
import type { AnalyticsPipeline } from './pipeline.js';
import type { ChannelTaxonomy } from './taxonomy.js';

/** Internal sources (Projects 1, 2, 11) pulled by the sync jobs (PRD 9.1). */
const INTERNAL = ['core_people', 'core_outcomes', 'crm_leads', 'crm_stage_changes', 'alumni_employment', 'alumni_referrals'];

/** "23:00" UTC → "03:00" (Yerevan is UTC+4 all year). */
const yerevan = (utc: string) => {
  const [hours, minutes] = utc.split(':').map(Number) as [number, number];
  return `${String((hours + 4) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export type SourceHealth = {
  name: string;
  description: string;
  kind: 'external' | 'internal';
  schedule: string;
  status: 'ok' | 'stale' | 'failing' | 'never_run' | 'running';
  lastRun: SyncRunView | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  recentRuns: SyncRunView[];
};

/**
 * Data Health (PRD 9.6, ANL-11): for each source the last successful pull, recent runs with row counts and
 * errors, and whether it is stale or failing; plus clean-table row counts and open unmapped values.
 */
export class DataHealth {
  constructor(
    private readonly deps: { jobs: JobRunner; pipeline: AnalyticsPipeline; taxonomy: ChannelTaxonomy; now?: () => Date },
  ) {}

  async report() {
    const now = this.deps.now?.() ?? new Date();
    const external = this.deps.pipeline.sourceNames();
    const names = new Set([...external, ...INTERNAL]);
    const statuses = (await this.deps.jobs.status()).filter((job) => names.has(job.name));
    const sources: SourceHealth[] = await Promise.all(
      statuses.map(async (job) => {
        const failures = await this.deps.jobs.consecutiveFailures(job.name);
        // Nightly sources are stale after 26 hours; interval jobs after three missed intervals.
        const allowedMs = job.dailyAtUtc ? 26 * 3_600_000 : Math.max(job.intervalMinutes, 1) * 3 * 60_000;
        const sinceSuccess = job.lastSuccessAt ? now.getTime() - Date.parse(job.lastSuccessAt) : null;
        const status: SourceHealth['status'] = job.running
          ? 'running'
          : failures > 0
            ? 'failing'
            : !job.lastRun
              ? 'never_run'
              : sinceSuccess !== null && sinceSuccess > allowedMs
                ? 'stale'
                : 'ok';
        return {
          name: job.name,
          description: job.description,
          kind: external.includes(job.name) ? 'external' : 'internal',
          schedule: job.dailyAtUtc ? `nightly ${yerevan(job.dailyAtUtc)} Yerevan` : `every ${job.intervalMinutes} min`,
          status,
          lastRun: job.lastRun,
          lastSuccessAt: job.lastSuccessAt,
          consecutiveFailures: failures,
          recentRuns: await this.deps.jobs.history(job.name, 5),
        };
      }),
    );
    const unmapped = await this.deps.taxonomy.unmapped();
    const bySource = new Map<string, number>();
    for (const value of unmapped) bySource.set(value.source, (bySource.get(value.source) ?? 0) + 1);
    return {
      checkedAt: now.toISOString(),
      sources: sources.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'external' ? -1 : 1)),
      tables: await this.deps.pipeline.rowCounts(),
      unmapped: [...bySource].map(([source, count]) => ({ source, count })),
    };
  }
}
