import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { touchpoints, type TouchpointRow } from '../db/schema.js';

export const TOUCHPOINT_TYPES = ['visit', 'form', 'click', 'open', 'registration', 'attendance', 'chat', 'referral'] as const;
export type TouchpointType = (typeof TOUCHPOINT_TYPES)[number];

export type Touchpoint = Omit<TouchpointRow, 'type'> & { type: TouchpointType };
export type NewTouchpoint = Pick<Touchpoint, 'contactId' | 'channel' | 'campaign' | 'type' | 'occurredAt' | 'sourceSystem' | 'sourceRef'> &
  Partial<Pick<Touchpoint, 'utmSource' | 'utmMedium'>>;

/** Touchpoints (PRD 12.1): the raw material of attribution (9.4) and the contact timeline (AUD-16). */
export class TouchpointRepository {
  constructor(private readonly db: AppPgDatabase) {}

  async record(input: NewTouchpoint): Promise<Touchpoint> {
    const [row] = await this.db.insert(touchpoints).values(input).returning();
    return row as Touchpoint;
  }

  /** Same source system and reference already stored: re-imports and retried webhooks stay idempotent. */
  async recordOnce(input: NewTouchpoint & { sourceRef: string }): Promise<Touchpoint | null> {
    const [existing] = await this.db
      .select({ id: touchpoints.id })
      .from(touchpoints)
      .where(and(eq(touchpoints.sourceSystem, input.sourceSystem), eq(touchpoints.sourceRef, input.sourceRef), eq(touchpoints.type, input.type)));
    return existing ? null : this.record(input);
  }

  async forContact(contactId: string): Promise<Touchpoint[]> {
    return (await this.db.select().from(touchpoints).where(eq(touchpoints.contactId, contactId)).orderBy(desc(touchpoints.occurredAt))) as Touchpoint[];
  }

  /** Moves touchpoints to another contact (AUD-05 merge keeps the full history). */
  async reassign(fromContactIds: string[], toContactId: string): Promise<void> {
    if (fromContactIds.length === 0) return;
    await this.db.update(touchpoints).set({ contactId: toContactId }).where(inArray(touchpoints.contactId, fromContactIds));
  }
}
