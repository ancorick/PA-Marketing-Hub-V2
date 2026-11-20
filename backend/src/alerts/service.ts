import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { alerts, type AlertRow } from '../db/schema.js';
import type { StaffRole } from '../integrations/core-engine/contract.js';

export type AlertInput = {
  level: 'warning' | 'critical';
  roles: StaffRole[];
  title: string;
  message: string;
  link?: string | null;
  dedupeKey?: string;
};

export type AlertView = {
  id: string;
  level: 'warning' | 'critical';
  title: string;
  message: string;
  link: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

const view = (row: AlertRow): AlertView => ({
  id: row.id,
  level: row.level as AlertView['level'],
  title: row.title,
  message: row.message,
  link: row.link,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  resolvedBy: row.resolvedBy,
});

/**
 * Staff alerts (7.4 "alert the marketing manager / admin", 14.4, ANL-11). In-app for now: staff emails come
 * from the Core Engine, so email delivery of alerts joins when the real integration exists (manual task 7).
 */
export class AlertService {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly logger: { warn: (obj: object, msg: string) => void },
  ) {}

  async raise(input: AlertInput): Promise<AlertView> {
    if (input.dedupeKey) {
      const [open] = await this.db
        .select()
        .from(alerts)
        .where(and(eq(alerts.dedupeKey, input.dedupeKey), isNull(alerts.resolvedAt)));
      if (open) return view(open);
    }
    const [row] = await this.db
      .insert(alerts)
      .values({ level: input.level, roles: input.roles, title: input.title, message: input.message, link: input.link ?? null, dedupeKey: input.dedupeKey ?? null })
      .returning();
    this.logger.warn({ alert: { level: input.level, title: input.title, roles: input.roles } }, 'staff alert raised');
    return view(row as AlertRow);
  }

  /** Open alerts for a role, newest first, then the last resolved ones for context. */
  async forRole(role: StaffRole, includeResolved = false): Promise<AlertView[]> {
    const rows = await this.db
      .select()
      .from(alerts)
      .where(and(sql`${role} = any(${alerts.roles})`, includeResolved ? undefined : isNull(alerts.resolvedAt)))
      .orderBy(desc(alerts.createdAt))
      .limit(50);
    return rows.map(view);
  }

  async resolve(id: string, actorId: string): Promise<AlertView | null> {
    const [row] = await this.db.update(alerts).set({ resolvedAt: new Date(), resolvedBy: actorId }).where(and(eq(alerts.id, id), isNull(alerts.resolvedAt))).returning();
    return row ? view(row) : null;
  }
}
