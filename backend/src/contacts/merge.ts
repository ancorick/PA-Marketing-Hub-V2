import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { TOPICS, type ConsentState, type Topic } from '../consent/wordings.js';
import type { AppPgDatabase } from '../db/client.js';
import { auditEvents, consentRecords, contacts, suppressions, touchpoints } from '../db/schema.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { statusFromSuppressions } from '../consent/service.js';
import { CONTACT_TYPES, hashEmail, MAX_TAGS, type ContactType } from './fields.js';
import type { Contact } from './repository.js';

export class MergeError extends Error {
  constructor(
    readonly code: 'not_found' | 'same_contact' | 'erased' | 'core_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'MergeError';
  }
}

/** Recorded states only: a topic with no record on one side keeps the other side's state. */
const RESTRICTIVENESS: Record<ConsentState, number> = { granted: 0, pending: 1, unknown: 2, withdrawn: 3 };

/** The further along the lifecycle, the more we know (PRD 6.1). */
const lifecycleRank = (type: ContactType) => CONTACT_TYPES.indexOf(type);

type MergeServiceDeps = {
  db: AppPgDatabase;
  coreEngine: Pick<CoreEngineClient, 'writeActivityLog'>;
  logger: { error: (obj: object, msg: string) => void };
};

/**
 * Merges a duplicate into the record to keep (AUD-05), in one transaction:
 * - earliest first touch wins, together with its source channel and campaign;
 * - the full touch and consent history moves to the kept record;
 * - per topic, the most restrictive recorded consent wins; the duplicate's unsubscribe or complaint is
 *   copied to the kept address (bounces belong to an address, not a person, and are not copied);
 * - tags are combined, empty fields are filled, monthly frequency wins over all.
 * The duplicate row is then deleted; its audit rows stay, pointing to the merge.
 */
export class MergeService {
  constructor(private readonly deps: MergeServiceDeps) {}

  async merge(keepId: string, otherId: string, actorId: string): Promise<Contact> {
    if (keepId === otherId) throw new MergeError('same_contact', 'Choose two different contacts');
    const merged = await this.deps.db.transaction(async (tx) => {
      const rows = (await tx.select().from(contacts).where(inArray(contacts.id, [keepId, otherId])).for('update')) as Contact[];
      const keep = rows.find((row) => row.id === keepId);
      const other = rows.find((row) => row.id === otherId);
      if (!keep || !other) throw new MergeError('not_found', 'Contact not found');
      if (keep.status === 'erased' || other.status === 'erased') throw new MergeError('erased', 'Erased contacts cannot be merged');
      if (keep.corePersonId && other.corePersonId && keep.corePersonId !== other.corePersonId) {
        throw new MergeError('core_conflict', 'The two contacts are linked to different Core Engine people; fix the link in the Core Engine first');
      }

      // Consent: latest recorded state per topic on each side, before the histories are combined.
      const consent = await tx
        .select()
        .from(consentRecords)
        .where(inArray(consentRecords.contactId, [keepId, otherId]))
        .orderBy(desc(consentRecords.createdAt));
      const latest = (contactId: string, topic: Topic) => consent.find((row) => row.contactId === contactId && row.topic === topic);
      await tx.update(consentRecords).set({ contactId: keepId }).where(eq(consentRecords.contactId, otherId));
      const corrections = TOPICS.flatMap((topic) => {
        const mine = latest(keepId, topic);
        const theirs = latest(otherId, topic);
        if (!theirs) return [];
        const winner = !mine || RESTRICTIVENESS[theirs.state as ConsentState] > RESTRICTIVENESS[mine.state as ConsentState] ? theirs : mine;
        // After the move the newest record decides; write the winner again if it is not already the newest.
        const newest = mine && mine.createdAt > theirs.createdAt ? mine : theirs;
        if (winner.state === newest.state) return [];
        return [
          {
            contactId: keepId,
            topic,
            state: winner.state,
            method: 'manual',
            wordingVersion: winner.wordingVersion,
            sourceUrl: null,
            ip: null,
            actorId,
            reason: `Merge: most restrictive consent kept (AUD-05)`,
          },
        ];
      });
      if (corrections.length > 0) await tx.insert(consentRecords).values(corrections);

      // An unsubscribe or complaint by the person follows them to the kept address.
      if (other.email && keep.email) {
        const theirs = await tx
          .select()
          .from(suppressions)
          .where(and(eq(suppressions.emailHash, hashEmail(other.email)), isNull(suppressions.liftedAt)));
        const reasons = [...new Set(theirs.map((row) => row.reason).filter((reason) => reason === 'unsubscribed' || reason === 'complaint'))];
        if (reasons.length > 0) {
          await tx.insert(suppressions).values(reasons.map((reason) => ({ emailHash: hashEmail(keep.email as string), reason, source: 'merge' })));
        }
      }
      const active = keep.email
        ? await tx.select().from(suppressions).where(and(eq(suppressions.emailHash, hashEmail(keep.email)), isNull(suppressions.liftedAt)))
        : [];

      await tx.update(touchpoints).set({ contactId: keepId }).where(eq(touchpoints.contactId, otherId));

      const earliest = other.firstTouchAt < keep.firstTouchAt ? other : keep;
      const linked = keep.corePersonId ? keep : other.corePersonId ? other : null;
      const changes: Partial<Contact> = {
        firstName: keep.firstName ?? other.firstName,
        lastName: keep.lastName ?? other.lastName,
        phone: keep.phone ?? other.phone,
        corePersonId: linked?.corePersonId ?? null,
        type: linked ? linked.type : lifecycleRank(other.type) > lifecycleRank(keep.type) ? other.type : keep.type,
        firstTouchAt: earliest.firstTouchAt,
        sourceChannel: earliest.sourceChannel ?? keep.sourceChannel ?? other.sourceChannel,
        sourceCampaign: earliest === keep ? keep.sourceCampaign : other.sourceCampaign,
        tags: [...new Set([...keep.tags, ...other.tags])].slice(0, MAX_TAGS),
        frequency: keep.frequency === 'monthly' || other.frequency === 'monthly' ? 'monthly' : 'all',
        status: statusFromSuppressions(active as { reason: 'unsubscribed' | 'hard_bounce' | 'complaint' | 'erased' }[]),
      };
      const changed = (Object.keys(changes) as (keyof Contact)[]).filter((key) => JSON.stringify(changes[key]) !== JSON.stringify(keep[key]));

      // The duplicate goes first: its unique email and Core Engine link must be free before the kept row takes them.
      await tx.delete(contacts).where(eq(contacts.id, otherId));
      const [updated] = await tx.update(contacts).set(changes).where(eq(contacts.id, keepId)).returning();
      await tx.insert(auditEvents).values([
        { entityType: 'contact', entityId: keepId, action: 'contact.merged', actorId, fields: changed },
        { entityType: 'contact', entityId: otherId, action: 'contact.merged_into', actorId, fields: [] },
      ]);
      return updated as Contact;
    });

    try {
      await this.deps.coreEngine.writeActivityLog({
        actorId,
        action: 'contact.merged',
        subjectType: 'contact',
        subjectId: keepId,
        occurredAt: new Date().toISOString(),
        metadata: { mergedContactId: otherId },
      });
    } catch (error) {
      this.deps.logger.error({ err: error }, 'activity log write failed');
    }
    return merged;
  }
}
