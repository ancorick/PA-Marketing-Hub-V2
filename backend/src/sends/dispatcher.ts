import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { ConsentService } from '../consent/service.js';
import type { Contact } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, contacts, deliveries, sends, touchpoints, type DeliveryRow } from '../db/schema.js';
import { SendBlockedError } from '../domains/send-gate.js';
import type { EmailAdapter } from '../email/adapter.js';
import type { JobResult } from '../jobs/runner.js';
import type { SegmentService } from '../segments/service.js';
import type { KillSwitch } from './kill-switch.js';
import type { SendService, SendView } from './service.js';

export type DispatcherOptions = {
  /** Messages per batch (EML-09). */
  batchSize: number;
  /** ESP rate limit; batches are spaced to stay under it (EML-09). */
  ratePerSecond: number;
  /** Stop a tick after this long so the next scheduled tick does not overlap. */
  tickBudgetMs: number;
  maxAttempts: number;
};

type DispatcherDeps = {
  db: AppPgDatabase;
  sends: SendService;
  segments: SegmentService;
  consent: Pick<ConsentService, 'isSuppressed'>;
  email: EmailAdapter;
  killSwitch: KillSwitch;
  logger: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  options: DispatcherOptions;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const MINUTE = 60_000;
/** A message claimed longer ago than this was interrupted by a crash (the ESP may or may not have it). */
const STALE_CLAIM_MS = 10 * MINUTE;
const MONTH_MS = 30 * 24 * 60 * MINUTE;

/**
 * Sends approved campaigns (EML-09, EML-10, EML-08, Flow B step 5).
 * - At start the audience is recalculated (AUD-14) and one delivery row per contact is created; the unique
 *   (send, contact) key makes this idempotent.
 * - Messages go out in batches spaced to the ESP rate limit, most engaged contacts first (EML-08).
 * - Before each message: kill switch, suppression list and frequency preference are checked again (Flow E:
 *   anyone who unsubscribed since scheduling is dropped).
 * - At most once: a delivery is claimed before the ESP call; a crash leaves it "unknown", never resent.
 *   Failed calls retry with exponential backoff, up to `maxAttempts`.
 */
export class SendDispatcher {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: DispatcherDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async tick(): Promise<JobResult> {
    const started = Date.now();
    // Interrupted claims: never resend (EML-10).
    await this.deps.db
      .update(deliveries)
      .set({ status: 'unknown', lastError: 'Interrupted while sending; not retried to avoid a duplicate' })
      .where(and(eq(deliveries.status, 'sending'), lt(deliveries.updatedAt, new Date(this.now().getTime() - STALE_CLAIM_MS))));

    if (await this.deps.killSwitch.isPaused()) return { rowsIn: 0, rowsUpserted: 0 };
    await this.decideAbTests();

    const due = await this.deps.db
      .select()
      .from(sends)
      .where(and(eq(sends.status, 'scheduled'), lte(sends.scheduledAt, this.now())));
    for (const row of due) await this.start(row.id);

    let sent = 0;
    let handled = 0;
    const active = await this.deps.db.select().from(sends).where(eq(sends.status, 'sending')).orderBy(asc(sends.startedAt));
    for (const row of active) {
      const result = await this.process(row.id, started);
      sent += result.sent;
      handled += result.handled;
      if (Date.now() - started > this.deps.options.tickBudgetMs) break;
    }
    return { rowsIn: handled, rowsUpserted: sent };
  }

  /** Materializes the audience at send time. */
  async start(sendId: string): Promise<void> {
    const send = await this.deps.sends.require(sendId);
    // Re-engagement sends (EML-15) are created with their recipients already queued.
    if (send.kind === 'reengagement') {
      await this.deps.sends.setStatus(sendId, { status: 'sending', startedAt: this.now() });
      return;
    }
    if (!send.segmentId) {
      await this.deps.sends.setStatus(sendId, { status: 'paused', pausedReason: 'The segment was deleted; choose another one' });
      return;
    }
    const where = await this.deps.segments.audienceWhere(send.segmentId, this.deps.sends.audienceOptions(send));
    if (!where) {
      await this.deps.sends.setStatus(sendId, { status: 'paused', pausedReason: 'The segment was deleted; choose another one' });
      return;
    }
    await this.deps.db.execute(
      sql`insert into ${deliveries} (send_id, contact_id, email) select ${sendId}, ${contacts.id}, ${contacts.email} from ${contacts} where ${where} on conflict (send_id, contact_id) do nothing`,
    );
    if (send.subjectB && !send.abWinner && !send.abDecideAt) await this.startAbTest(send);
    await this.deps.sends.setStatus(sendId, { status: 'sending', startedAt: send.startedAt ? new Date(send.startedAt) : this.now() });
  }

  /**
   * NWS-16: a random sample (abSamplePercent) is split evenly between subjects A and B; everyone else is
   * held until the winner is picked after abWaitHours.
   */
  private async startAbTest(send: SendView) {
    const rows = await this.deps.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.sendId, send.id), eq(deliveries.status, 'queued')))
      .orderBy(sql`random()`);
    if (rows.length < 2) return;
    const sample = Math.min(rows.length, Math.max(2, Math.ceil((rows.length * (send.abSamplePercent ?? 20)) / 100)));
    const ids = rows.map((row) => row.id);
    const half = Math.ceil(sample / 2);
    const assign = async (slice: string[], values: Partial<typeof deliveries.$inferInsert>) => {
      for (let i = 0; i < slice.length; i += 1000) await this.deps.db.update(deliveries).set(values).where(inArray(deliveries.id, slice.slice(i, i + 1000)));
    };
    await assign(ids.slice(0, half), { variant: 'A' });
    await assign(ids.slice(half, sample), { variant: 'B' });
    await assign(ids.slice(sample), { status: 'held' });
    await this.deps.sends.setStatus(send.id, { abDecideAt: new Date(this.now().getTime() + (send.abWaitHours ?? 4) * 3_600_000) });
  }

  /** NWS-16: the subject with the higher unique click rate wins (opens break ties; they are estimates, 7.5). */
  async decideAbTests(): Promise<void> {
    const due = await this.deps.db
      .select()
      .from(sends)
      .where(and(isNull(sends.abWinner), lte(sends.abDecideAt, this.now())));
    for (const send of due) {
      const stats = await this.deps.db
        .select({
          variant: deliveries.variant,
          sent: sql<number>`count(*) filter (where ${deliveries.sentAt} is not null)`,
          clicks: sql<number>`count(${deliveries.firstClickAt})`,
          opens: sql<number>`count(${deliveries.openedAt})`,
        })
        .from(deliveries)
        .where(and(eq(deliveries.sendId, send.id), inArray(deliveries.variant, ['A', 'B'])))
        .groupBy(deliveries.variant);
      const rate = (variant: string, key: 'clicks' | 'opens') => {
        const row = stats.find((item) => item.variant === variant);
        return row && Number(row.sent) > 0 ? Number(row[key]) / Number(row.sent) : 0;
      };
      const winner =
        rate('B', 'clicks') > rate('A', 'clicks') || (rate('B', 'clicks') === rate('A', 'clicks') && rate('B', 'opens') > rate('A', 'opens')) ? 'B' : 'A';
      await this.deps.db.update(sends).set({ abWinner: winner }).where(eq(sends.id, send.id));
      await this.deps.db
        .update(deliveries)
        .set({ status: 'queued', variant: winner })
        .where(and(eq(deliveries.sendId, send.id), eq(deliveries.status, 'held')));
    }
  }

  private async process(sendId: string, tickStarted: number): Promise<{ sent: number; handled: number }> {
    let sent = 0;
    let handled = 0;
    const { batchSize, ratePerSecond, tickBudgetMs } = this.deps.options;
    for (;;) {
      const send = await this.deps.sends.require(sendId);
      if (send.status !== 'sending') break;
      if (await this.deps.killSwitch.isPaused()) break;
      const batch = await this.nextBatch(sendId, batchSize);
      if (batch.length === 0) {
        await this.finishIfDone(sendId);
        break;
      }
      const batchStarted = Date.now();
      let stop = false;
      for (const delivery of batch) {
        const outcome = await this.deliver(send, delivery);
        handled += 1;
        if (outcome === 'sent') sent += 1;
        if (outcome === 'stop') {
          stop = true;
          break;
        }
      }
      if (sent > 0) await this.deps.db.update(sends).set({ sentCount: sql`${sends.sentCount} + ${sent}` }).where(eq(sends.id, sendId));
      sent = 0;
      if (stop || Date.now() - tickStarted > tickBudgetMs) break;
      // Space batches so the ESP sees at most ratePerSecond messages a second.
      const minimumMs = (batch.length / ratePerSecond) * 1000;
      const elapsed = Date.now() - batchStarted;
      if (elapsed < minimumMs) await this.sleep(minimumMs - elapsed);
    }
    return { sent, handled };
  }

  /** Queued messages that are due, most recently engaged contacts first (EML-08). */
  private async nextBatch(sendId: string, size: number): Promise<DeliveryRow[]> {
    const engagement = sql`(select max(${touchpoints.occurredAt}) from ${touchpoints} where ${touchpoints.contactId} = ${deliveries.contactId} and ${touchpoints.type} in ('click', 'open'))`;
    return this.deps.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.sendId, sendId), eq(deliveries.status, 'queued'), or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, this.now()))))
      .orderBy(sql`${engagement} desc nulls last`, asc(deliveries.id))
      .limit(size);
  }

  private async deliver(send: SendView, delivery: DeliveryRow): Promise<'sent' | 'skipped' | 'retry' | 'failed' | 'stop'> {
    const [claimed] = await this.deps.db
      .update(deliveries)
      .set({ status: 'sending', attempts: delivery.attempts + 1 })
      .where(and(eq(deliveries.id, delivery.id), eq(deliveries.status, 'queued')))
      .returning();
    if (!claimed) return 'skipped';

    const skip = async (reason: string) => {
      await this.deps.db.update(deliveries).set({ status: 'skipped', skipReason: reason }).where(eq(deliveries.id, delivery.id));
      return 'skipped' as const;
    };
    const [contact] = delivery.contactId ? ((await this.deps.db.select().from(contacts).where(eq(contacts.id, delivery.contactId))) as Contact[]) : [];
    if (!contact?.email) return skip('contact removed');
    if (contact.status !== 'active' || (await this.deps.consent.isSuppressed(contact.email))) return skip('suppressed');
    // The send's topic must be granted; a re-engagement email goes to anyone with at least one granted topic.
    const records = await this.deps.db
      .select({ topic: consentRecords.topic, state: consentRecords.state })
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contact.id))
      .orderBy(desc(consentRecords.createdAt));
    const latest = new Map<string, string>();
    for (const record of records) if (!latest.has(record.topic)) latest.set(record.topic, record.state);
    const consented = send.kind === 'reengagement' ? [...latest.values()].includes('granted') : latest.get(send.topic) === 'granted';
    if (!consented) return skip('no consent');
    if (contact.frequency === 'monthly') {
      const [recent] = await this.deps.db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.contactId, contact.id), ne(deliveries.sendId, send.id), inArray(deliveries.status, ['sent', 'delivered']), gte(deliveries.sentAt, new Date(this.now().getTime() - MONTH_MS))))
        .limit(1);
      if (recent) return skip('frequency: monthly');
    }

    const rendered = this.deps.sends.renderFor(send, contact, { variant: delivery.variant });
    try {
      const result = await this.deps.email.send({
        idempotencyKey: `${send.id}:${contact.id}`,
        stream: 'marketing',
        from: rendered.from,
        to: contact.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        tags: { sendId: send.id, kind: send.kind },
      });
      await this.deps.db
        .update(deliveries)
        .set({ status: 'sent', espMessageId: result.messageId, sentAt: result.acceptedAt, lastError: null })
        .where(eq(deliveries.id, delivery.id));
      return 'sent';
    } catch (error) {
      if (error instanceof SendBlockedError) {
        // Not attempted: put it back without counting the attempt.
        await this.deps.db.update(deliveries).set({ status: 'queued', attempts: delivery.attempts }).where(eq(deliveries.id, delivery.id));
        if (error.kind === 'not_verified') await this.deps.sends.setStatus(send.id, { status: 'paused', pausedReason: error.message });
        return 'stop';
      }
      const attempts = delivery.attempts + 1;
      const message = (error as Error).message?.slice(0, 500) ?? 'ESP error';
      if (attempts >= this.deps.options.maxAttempts) {
        await this.deps.db.update(deliveries).set({ status: 'failed', lastError: message }).where(eq(deliveries.id, delivery.id));
        this.deps.logger.error({ sendId: send.id, deliveryId: delivery.id, err: error }, 'delivery failed after retries');
        return 'failed';
      }
      // Exponential backoff: 2, 4, 8, 16 minutes.
      await this.deps.db
        .update(deliveries)
        .set({ status: 'queued', lastError: message, nextAttemptAt: new Date(this.now().getTime() + 2 ** attempts * MINUTE) })
        .where(eq(deliveries.id, delivery.id));
      this.deps.logger.warn({ sendId: send.id, deliveryId: delivery.id, attempts }, 'delivery failed; retrying with backoff');
      return 'retry';
    }
  }

  private async finishIfDone(sendId: string) {
    const [open] = await this.deps.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.sendId, sendId), inArray(deliveries.status, ['queued', 'sending', 'held'])))
      .limit(1);
    if (!open) await this.deps.sends.setStatus(sendId, { status: 'sent', finishedAt: this.now() });
  }
}
