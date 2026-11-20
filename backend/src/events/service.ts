import { and, count, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AlertService } from '../alerts/service.js';
import type { ConsentService } from '../consent/service.js';
import type { AppPgDatabase } from '../db/client.js';
import { contactImports, contacts, deliveries, espEvents, sends } from '../db/schema.js';
import type { EspEvent } from '../email/webhooks.js';
import type { KillSwitch } from '../sends/kill-switch.js';
import type { TouchpointRepository } from '../touchpoints/repository.js';

const DAY = 86_400_000;

/** PRD 7.4 thresholds. A send is judged only after a minimum number of messages, so one early bounce does not pause it. */
export const GUARDRAILS = {
  hardBounceRate: 0.05,
  hardBounceWindow: 1000,
  complaintRate: 0.003,
  importFirstSendBounceRate: 0.1,
  minimumSample: 20,
  softBouncesToSuppress: 3,
  softBounceWindowDays: 30,
} as const;

type Deps = {
  db: AppPgDatabase;
  consent: Pick<ConsentService, 'suppress' | 'unsubscribeAll'>;
  touchpoints: TouchpointRepository;
  alerts: AlertService;
  killSwitch: KillSwitch;
  logger: { warn: (obj: object, msg: string) => void };
};

/**
 * ESP feedback (EML-04 to EML-06) and the deliverability guardrails (7.4). Events are processed as they
 * arrive (NFR-F5) and at most once per event ID, because providers retry webhooks.
 */
export class EspEventService {
  constructor(private readonly deps: Deps) {}

  async process(events: EspEvent[]): Promise<{ processed: number; duplicates: number }> {
    let processed = 0;
    let duplicates = 0;
    for (const event of events) {
      const inserted = await this.deps.db
        .insert(espEvents)
        .values({ id: event.id, type: event.type, messageId: event.messageId ?? null, occurredAt: new Date(event.occurredAt), payload: event })
        .onConflictDoNothing()
        .returning({ id: espEvents.id });
      if (inserted.length === 0) {
        duplicates += 1;
        continue;
      }
      await this.handle(event);
      processed += 1;
    }
    return { processed, duplicates };
  }

  private async handle(event: EspEvent) {
    const at = new Date(event.occurredAt);
    if (event.type === 'account_warning') {
      // 7.4: pause all marketing sends and alert the admin.
      await this.deps.killSwitch.set(true, 'esp', `ESP account warning: ${event.detail ?? 'see the ESP dashboard'}`);
      await this.deps.alerts.raise({ level: 'critical', roles: ['admin', 'marketing_manager'], title: 'ESP account warning: all sending paused', message: event.detail ?? 'The email service reported a problem with the account.', link: '#/email-settings', dedupeKey: 'esp-account-warning' });
      return;
    }
    const [delivery] = event.messageId ? await this.deps.db.select().from(deliveries).where(eq(deliveries.espMessageId, event.messageId)) : [];
    const email = (delivery?.email ?? event.email ?? '').trim().toLowerCase();
    const [send] = delivery ? await this.deps.db.select().from(sends).where(eq(sends.id, delivery.sendId)) : [];
    const update = (values: Partial<typeof deliveries.$inferInsert>) => (delivery ? this.deps.db.update(deliveries).set(values).where(eq(deliveries.id, delivery.id)) : Promise.resolve());

    switch (event.type) {
      case 'delivered':
        if (delivery?.status === 'sent') await update({ status: 'delivered', deliveredAt: at });
        return;
      case 'opened':
      case 'clicked': {
        if (event.type === 'opened' && delivery && !delivery.openedAt) await update({ openedAt: at });
        if (event.type === 'clicked' && delivery && !delivery.firstClickAt) await update({ firstClickAt: at, ...(!delivery.openedAt && { openedAt: at }) });
        if (delivery?.contactId) {
          await this.deps.touchpoints.recordOnce({
            contactId: delivery.contactId,
            channel: 'email',
            campaign: send?.utmCampaign ?? null,
            type: event.type === 'opened' ? 'open' : 'click',
            occurredAt: at,
            sourceSystem: 'esp',
            sourceRef: event.id,
          });
        }
        return;
      }
      case 'unsubscribed':
        await update({ unsubscribedAt: at });
        if (delivery?.contactId) await this.deps.consent.unsubscribeAll(delivery.contactId, 'list_unsubscribe', { kind: 'system', name: 'esp' });
        return;
      case 'complained':
        // EML-06: unsubscribe from all marketing and record the complaint.
        await update({ status: 'complained' });
        if (email) await this.deps.consent.suppress(email, 'complaint', 'esp_webhook');
        if (send) await this.checkSend(send.id);
        return;
      case 'bounced':
        if (event.bounceType === 'hard') {
          // EML-05: hard bounce suppresses at once.
          await update({ status: 'bounced_hard' });
          if (email) await this.deps.consent.suppress(email, 'hard_bounce', 'esp_webhook');
        } else {
          await update({ status: 'bounced_soft' });
          if (email) await this.softBounce(email);
        }
        if (send) await this.checkSend(send.id);
        if (delivery?.contactId) await this.checkImport(delivery.contactId);
        return;
    }
  }

  /** EML-05: three soft bounces in 30 days suppress the address and flag it for review. */
  private async softBounce(email: string) {
    const [row] = await this.deps.db
      .select({ value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.email, email), eq(deliveries.status, 'bounced_soft'), gte(deliveries.sentAt, new Date(Date.now() - GUARDRAILS.softBounceWindowDays * DAY))));
    if ((row?.value ?? 0) < GUARDRAILS.softBouncesToSuppress) return;
    await this.deps.consent.suppress(email, 'hard_bounce', 'repeated_soft_bounces');
    const [contact] = await this.deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email));
    await this.deps.alerts.raise({
      level: 'warning',
      roles: ['marketing_manager', 'admin'],
      title: 'Address suppressed after repeated soft bounces',
      message: `${email} soft-bounced ${row?.value} times in ${GUARDRAILS.softBounceWindowDays} days and no longer receives marketing email. Check the address with the person.`,
      link: contact ? `#/audience/contacts/${contact.id}` : null,
      dedupeKey: `soft-bounce:${email}`,
    });
  }

  /** 7.4: pause a send whose hard bounce rate (first 1,000 messages) or complaint rate is too high. */
  private async checkSend(sendId: string) {
    const [stats] = await this.deps.db
      .select({
        sent: sql<number>`count(*) filter (where ${deliveries.sentAt} is not null)`,
        hard: sql<number>`count(*) filter (where ${deliveries.status} = 'bounced_hard')`,
        complaints: sql<number>`count(*) filter (where ${deliveries.status} = 'complained')`,
      })
      .from(deliveries)
      .where(eq(deliveries.sendId, sendId));
    const sent = Number(stats?.sent ?? 0);
    if (sent < GUARDRAILS.minimumSample) return;
    const bounceRate = Number(stats?.hard ?? 0) / Math.min(sent, GUARDRAILS.hardBounceWindow);
    const complaintRate = Number(stats?.complaints ?? 0) / sent;
    const problem =
      complaintRate > GUARDRAILS.complaintRate
        ? { what: `spam complaints ${(complaintRate * 100).toFixed(2)}% (limit 0.3%)`, roles: ['marketing_manager', 'admin'] as const }
        : sent <= GUARDRAILS.hardBounceWindow && bounceRate > GUARDRAILS.hardBounceRate
          ? { what: `hard bounces ${(bounceRate * 100).toFixed(1)}% in the first messages (limit 5%)`, roles: ['marketing_manager'] as const }
          : null;
    if (!problem) return;
    const paused = await this.deps.db
      .update(sends)
      .set({ status: 'paused', pausedReason: `Guardrail: ${problem.what}` })
      .where(and(eq(sends.id, sendId), inArray(sends.status, ['sending', 'scheduled'])))
      .returning({ name: sends.name });
    if (paused.length === 0) return;
    await this.deps.alerts.raise({
      level: 'critical',
      roles: [...problem.roles],
      title: `“${paused[0]?.name}” paused by a deliverability guardrail`,
      message: `${problem.what}. Check the list and the content before resuming.`,
      link: `#/campaigns/${sendId}`,
      dedupeKey: `guardrail:${sendId}`,
    });
  }

  /** 7.4: more than 10% hard bounces on an import's first send blocks that import until reviewed. */
  private async checkImport(contactId: string) {
    const [contact] = await this.deps.db.select({ importId: contacts.importId }).from(contacts).where(eq(contacts.id, contactId));
    if (!contact?.importId) return;
    const [record] = await this.deps.db.select().from(contactImports).where(eq(contactImports.id, contact.importId));
    if (!record || record.sendBlockedAt || record.reviewedAt) return;
    // First send to each imported contact: their earliest delivery.
    const firstSends = this.deps.db.$with('first_sends').as(
      this.deps.db
        .selectDistinctOn([deliveries.contactId], { contactId: deliveries.contactId, status: deliveries.status })
        .from(deliveries)
        .innerJoin(contacts, eq(contacts.id, deliveries.contactId))
        .where(and(eq(contacts.importId, record.id), isNotNull(deliveries.sentAt)))
        .orderBy(deliveries.contactId, deliveries.sentAt),
    );
    const [stats] = await this.deps.db
      .with(firstSends)
      .select({ total: count(), hard: sql<number>`count(*) filter (where ${firstSends.status} = 'bounced_hard')` })
      .from(firstSends);
    const total = Number(stats?.total ?? 0);
    if (total < GUARDRAILS.minimumSample || Number(stats?.hard ?? 0) / total <= GUARDRAILS.importFirstSendBounceRate) return;
    await this.deps.db.update(contactImports).set({ sendBlockedAt: new Date() }).where(and(eq(contactImports.id, record.id), isNull(contactImports.sendBlockedAt)));
    await this.deps.alerts.raise({
      level: 'critical',
      roles: ['marketing_manager', 'admin'],
      title: `Import “${record.fileName}” blocked from sends`,
      message: `More than 10% of its contacts hard-bounced on their first send. Review the list, then unblock it on the Import screen.`,
      link: '#/audience/import',
      dedupeKey: `import-blocked:${record.id}`,
    });
  }
}
