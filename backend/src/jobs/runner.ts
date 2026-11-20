import { and, desc, eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { syncRuns, type SyncRunRow } from '../db/schema.js';

export type JobContext = {
  /** Start of the window to pull: the last successful run's end minus the overlap; null on the first run. */
  windowFrom: Date | null;
  windowTo: Date;
};

export type JobResult = { rowsIn: number; rowsUpserted: number };

export type JobDefinition = {
  name: string;
  description: string;
  /** How often the scheduler starts it; 0 = manual only. */
  intervalMs: number;
  /** Re-read this much before the last window end, so late-arriving changes are not missed (9.2). */
  overlapMs?: number;
  run: (context: JobContext) => Promise<JobResult>;
};

export type JobStatus = {
  name: string;
  description: string;
  intervalMinutes: number;
  running: boolean;
  lastRun: SyncRunView | null;
  lastSuccessAt: string | null;
};

export type SyncRunView = {
  id: string;
  status: 'running' | 'ok' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  rowsIn: number;
  rowsUpserted: number;
  error: string | null;
  triggeredBy: string;
};

const view = (row: SyncRunRow): SyncRunView => ({
  id: row.id,
  status: row.status as SyncRunView['status'],
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  rowsIn: row.rowsIn,
  rowsUpserted: row.rowsUpserted,
  error: row.error,
  triggeredBy: row.triggeredBy,
});

type RunnerDeps = {
  db: AppPgDatabase;
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  /** Called when a run fails (alerting, PRD 14.4). */
  onFailure?: (job: JobDefinition, error: Error) => Promise<void>;
  now?: () => Date;
};

/**
 * Scheduled jobs (PRD 14.4): every run is recorded in sync_runs with its window, row counts and error;
 * a job never runs twice at once in this process; staff can re-run any job. On Render one instance runs
 * the scheduler; a second instance would need a Postgres advisory lock before enabling it there.
 */
export class JobRunner {
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly running = new Map<string, Promise<SyncRunView>>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly now: () => Date;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  register(job: JobDefinition) {
    this.jobs.set(job.name, job);
  }

  start() {
    for (const job of this.jobs.values()) {
      if (job.intervalMs <= 0) continue;
      const timer = setInterval(() => {
        void this.run(job.name, 'scheduler').catch(() => {});
      }, job.intervalMs);
      timer.unref();
      this.timers.push(timer);
    }
  }

  stop() {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  has(name: string) {
    return this.jobs.has(name);
  }

  /** Runs a job now; a run already in progress is joined instead of started twice. */
  run(name: string, triggeredBy: string): Promise<SyncRunView> {
    const existing = this.running.get(name);
    if (existing) return existing;
    const job = this.jobs.get(name);
    if (!job) return Promise.reject(new Error(`Unknown job ${name}`));
    const promise = this.execute(job, triggeredBy).finally(() => this.running.delete(name));
    this.running.set(name, promise);
    return promise;
  }

  async status(): Promise<JobStatus[]> {
    return Promise.all(
      [...this.jobs.values()].map(async (job) => {
        const [last] = await this.deps.db.select().from(syncRuns).where(eq(syncRuns.source, job.name)).orderBy(desc(syncRuns.startedAt)).limit(1);
        const success = await this.lastSuccess(job.name);
        return {
          name: job.name,
          description: job.description,
          intervalMinutes: Math.round(job.intervalMs / 60_000),
          running: this.running.has(job.name),
          lastRun: last ? view(last) : null,
          lastSuccessAt: success?.finishedAt?.toISOString() ?? null,
        };
      }),
    );
  }

  async history(name: string, limit = 20): Promise<SyncRunView[]> {
    const rows = await this.deps.db.select().from(syncRuns).where(eq(syncRuns.source, name)).orderBy(desc(syncRuns.startedAt)).limit(limit);
    return rows.map(view);
  }

  private async lastSuccess(name: string) {
    const [row] = await this.deps.db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.source, name), eq(syncRuns.status, 'ok')))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    return row ?? null;
  }

  private async execute(job: JobDefinition, triggeredBy: string): Promise<SyncRunView> {
    const previous = await this.lastSuccess(job.name);
    const windowTo = this.now();
    const windowFrom = previous?.windowTo ? new Date(previous.windowTo.getTime() - (job.overlapMs ?? 0)) : null;
    const [run] = await this.deps.db
      .insert(syncRuns)
      .values({ source: job.name, startedAt: this.now(), status: 'running', windowFrom, windowTo, triggeredBy })
      .returning();
    const id = (run as SyncRunRow).id;
    try {
      const result = await job.run({ windowFrom, windowTo });
      const [done] = await this.deps.db
        .update(syncRuns)
        .set({ status: 'ok', finishedAt: this.now(), rowsIn: result.rowsIn, rowsUpserted: result.rowsUpserted })
        .where(eq(syncRuns.id, id))
        .returning();
      this.deps.logger.info({ job: job.name, ...result }, 'job finished');
      return view(done as SyncRunRow);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      const [failed] = await this.deps.db
        .update(syncRuns)
        .set({ status: 'failed', finishedAt: this.now(), error: message.slice(0, 2000) })
        .where(eq(syncRuns.id, id))
        .returning();
      this.deps.logger.error({ job: job.name, err: error }, 'job failed');
      await this.deps.onFailure?.(job, error as Error).catch(() => {});
      return view(failed as SyncRunRow);
    }
  }
}
