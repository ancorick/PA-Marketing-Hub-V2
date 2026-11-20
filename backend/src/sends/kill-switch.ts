import { eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { appSettings } from '../db/schema.js';

export type KillSwitchState = { paused: boolean; reason: string | null; by: string | null; at: string | null };

const KEY = 'kill_switch';

/**
 * EML-14: one switch pauses every marketing send (campaigns, newsletters, re-engagement). Checked by the
 * dispatcher before each batch and by the email gate before each message; transactional mail is not affected.
 */
export class KillSwitch {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async state(): Promise<KillSwitchState> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const value = (row?.value ?? {}) as Partial<KillSwitchState>;
    return { paused: value.paused === true, reason: value.reason ?? null, by: value.by ?? null, at: value.at ?? null };
  }

  async isPaused(): Promise<boolean> {
    return (await this.state()).paused;
  }

  async set(paused: boolean, actorId: string, reason: string | null): Promise<KillSwitchState> {
    const value = { paused, reason, by: actorId, at: this.now().toISOString() };
    await this.db
      .insert(appSettings)
      .values({ key: KEY, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actorId, updatedAt: this.now() } });
    return value;
  }
}
