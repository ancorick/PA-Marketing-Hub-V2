import { desc } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { auditEvents, exportLog, syncRuns } from '../db/schema.js';

export type ActivityEvent = {
  id: string;
  at: string;
  /** Staff user ID, "scheduler" or "system:<service>". */
  who: string;
  /** e.g. contact.updated, job.run, export.segment_csv */
  action: string;
  /** What the action touched, e.g. "contact", a job name or a segment name. */
  entity: string;
  /** Short machine-readable detail: changed field names, row counts, status. Never personal data. */
  details: Record<string, unknown>;
};

const PER_SOURCE = 600;

/**
 * Activity log of the Admin page (PRD 12.4, AUD-19, RESTRUCTURE R5): one time-ordered list built from the audit
 * trail of contact changes, the job run history and the export log. It shows which fields changed, never their
 * values, so erasure leaves nothing personal behind.
 */
export class ActivityLog {
  constructor(private readonly db: AppPgDatabase) {}

  async list(options: { action?: string; limit: number; offset: number }) {
    const [audit, runs, exports] = await Promise.all([
      this.db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(PER_SOURCE),
      this.db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(PER_SOURCE),
      this.db.select().from(exportLog).orderBy(desc(exportLog.createdAt)).limit(PER_SOURCE),
    ]);
    const events: ActivityEvent[] = [
      ...audit.map((row) => ({
        id: `audit:${row.id}`,
        at: row.createdAt.toISOString(),
        who: row.actorId,
        action: row.action,
        entity: row.entityType,
        details: { fields: row.fields },
      })),
      ...runs.map((row) => ({
        id: `run:${row.id}`,
        at: row.startedAt.toISOString(),
        who: row.triggeredBy,
        action: row.status === 'failed' ? 'job.failed' : 'job.run',
        entity: row.source,
        details: { status: row.status, rowsIn: row.rowsIn, rowsSaved: row.rowsUpserted, ...(row.error ? { error: row.error } : {}) },
      })),
      ...exports.map((row) => ({
        id: `export:${row.id}`,
        at: row.createdAt.toISOString(),
        who: row.actorId,
        action: `export.${row.kind}`,
        entity: row.segmentName ?? 'contact',
        details: { rows: row.rowCount },
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const actions = [...new Set(events.map((event) => event.action))].sort();
    const matching = options.action ? events.filter((event) => event.action === options.action) : events;
    return { actions, total: matching.length, events: matching.slice(options.offset, options.offset + options.limit) };
  }
}
