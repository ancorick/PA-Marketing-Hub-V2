import { and, eq } from 'drizzle-orm';
import { CONSENT_WORDINGS } from '../consent/wordings.js';
import { hashEmail } from '../contacts/fields.js';
import type { ConsentRepository } from '../consent/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { exportLog, segments } from '../db/schema.js';
import type { SegmentService } from '../segments/service.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';

import { EVENT_HUB_ACTOR } from './service.js';
const MAX_INVITEES = 10_000;

/**
 * What Marketing Hub provides to Event Hub (PRD 10.2, EVT-07): segments a marketing manager shared for event
 * invitations, with only the people who may receive them (reachable, events consent granted, not suppressed);
 * a suppression check for any list; and the consent wordings for registration forms (AUD-07).
 */
export class EventHubIntegration {
  constructor(
    private readonly deps: {
      db: AppPgDatabase;
      segments: Pick<SegmentService, 'audience'>;
      consentRepository: Pick<ConsentRepository, 'activeByHashes'>;
      coreEngine: Pick<CoreEngineClient, 'writeActivityLog'>;
    },
  ) {}

  async sharedSegments() {
    const rows = await this.deps.db.select().from(segments).where(eq(segments.sharedWithEventHub, true));
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt.toISOString() }));
  }

  /** Invitees of a shared segment; every pull is written to the export log (AUD-19, NFR-P4). */
  async invitees(segmentId: string) {
    const [segment] = await this.deps.db.select().from(segments).where(and(eq(segments.id, segmentId), eq(segments.sharedWithEventHub, true)));
    if (!segment) return null;
    const audience = await this.deps.segments.audience(segmentId, { topic: 'events' });
    const suppressed = await this.suppressed(audience.map((contact) => contact.email as string));
    const invitees = audience
      .filter((contact) => contact.email && !suppressed.has(contact.email))
      .slice(0, MAX_INVITEES)
      .map((contact) => ({ corePersonId: contact.corePersonId, email: contact.email as string, firstName: contact.firstName, language: contact.language }));
    await this.deps.db.insert(exportLog).values({ actorId: EVENT_HUB_ACTOR, kind: 'event_hub_invitees', segmentId, segmentName: segment.name, rowCount: invitees.length });
    // NFR-S8: personal data leaving Marketing Hub goes to the Core Engine activity log as well.
    await this.deps.coreEngine
      .writeActivityLog({ actorId: EVENT_HUB_ACTOR, action: 'export.event_hub_invitees', subjectType: 'segment', subjectId: segmentId, reason: `${invitees.length} invitees`, occurredAt: new Date().toISOString() })
      .catch(() => {});
    return { segmentId, segmentName: segment.name, purpose: 'event_invitation' as const, consentTopic: 'events' as const, invitees };
  }

  /** Which of these addresses must never get promotional mail (10.2: suppression status for Event Hub). */
  async suppressed(emails: string[]): Promise<Set<string>> {
    const byHash = new Map(emails.map((email) => [hashEmail(email), email]));
    const result = new Set<string>();
    const hashes = [...byHash.keys()];
    for (let i = 0; i < hashes.length; i += 1000) {
      const active = await this.deps.consentRepository.activeByHashes(hashes.slice(i, i + 1000));
      for (const hash of active.keys()) result.add(byHash.get(hash) as string);
    }
    return result;
  }

  consentWordings() {
    return CONSENT_WORDINGS;
  }
}
