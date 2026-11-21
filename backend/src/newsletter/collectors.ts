import { and, gte, lte } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { collectedItems, events, type CollectedItemRow } from '../db/schema.js';
import type { AlumniTrackerClient } from '../integrations/alumni-tracker/contract.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import type { GroupLaunchpadClient } from '../integrations/group-launchpad/contract.js';
import type { LibraryClient } from '../integrations/library/contract.js';

export const ITEM_TYPES = ['upcoming_event', 'recent_event', 'library', 'graduation', 'hire', 'new_group'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type CollectedItem = Omit<CollectedItemRow, 'type'> & { type: ItemType };

type NewItem = {
  sourceSystem: string;
  sourceRef: string;
  type: ItemType;
  title: string;
  url: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
  publishable: boolean;
  skipReason: string | null;
};

const DAY = 86_400_000;
/** 8.2: upcoming events in the next 45 days. */
const UPCOMING_DAYS = 45;

/** A link the newsletter may point to: HTTPS only ("legitimate sources only", 8.2). */
const safeLink = (url: string | null | undefined) => Boolean(url && /^https:\/\/[^\s]+$/.test(url));

const rule = (checks: [boolean, string][]) => {
  const failed = checks.find(([ok]) => !ok);
  return failed ? { publishable: false, skipReason: failed[1] } : { publishable: true, skipReason: null };
};

type Deps = {
  db: AppPgDatabase;
  coreEngine: Pick<CoreEngineClient, 'listGraduationsSince' | 'getPerson'>;
  alumni: Pick<AlumniTrackerClient, 'listEmploymentChangedSince'>;
  library: LibraryClient;
  groupLaunchpad: GroupLaunchpadClient;
};

/**
 * Newsletter collectors (NWS-02, PRD 8.2): one per source, each item stored with a link to its source record
 * and the result of its publish rule. People are never named unless they agreed to be featured.
 */
export class Collectors {
  constructor(private readonly deps: Deps) {}

  /** Collects everything for a period ending at `until`; upcoming events look ahead from `sendAt`. */
  async collect(since: Date, until: Date, sendAt: Date): Promise<{ items: CollectedItem[]; failures: { source: string; error: string }[] }> {
    const failures: { source: string; error: string }[] = [];
    const run = async (source: string, collector: () => Promise<NewItem[]>) => {
      try {
        return await collector();
      } catch (error) {
        // One source down must not block the draft; the editor sees what is missing.
        failures.push({ source, error: (error as Error).message });
        return [];
      }
    };
    const found = (
      await Promise.all([
        run('events', () => this.events(since, until, sendAt)),
        run('library', () => this.library(since)),
        run('graduations', () => this.graduations(since)),
        run('alumni_hires', () => this.hires(since)),
        run('new_groups', () => this.newGroups(since, sendAt)),
      ])
    ).flat();

    const stored: CollectedItem[] = [];
    for (const item of found) {
      const [row] = await this.deps.db
        .insert(collectedItems)
        .values(item)
        .onConflictDoUpdate({
          target: [collectedItems.sourceSystem, collectedItems.sourceRef, collectedItems.type],
          set: { title: item.title, url: item.url, occurredAt: item.occurredAt, payload: item.payload, publishable: item.publishable, skipReason: item.skipReason, updatedAt: new Date() },
        })
        .returning();
      stored.push(row as CollectedItem);
    }
    return { items: stored, failures };
  }

  private async events(since: Date, until: Date, sendAt: Date): Promise<NewItem[]> {
    const horizon = new Date(sendAt.getTime() + UPCOMING_DAYS * DAY);
    const [upcoming, recent] = await Promise.all([
      this.deps.db.select().from(events).where(and(gte(events.startsAt, until), lte(events.startsAt, new Date(horizon.getTime() + 30 * DAY)))),
      this.deps.db.select().from(events).where(and(gte(events.startsAt, since), lte(events.startsAt, until))),
    ]);
    return [
      ...upcoming.map((event) => ({
        sourceSystem: event.externalId ? 'event_hub' : 'manual_event',
        sourceRef: event.externalId ?? event.id,
        type: 'upcoming_event' as const,
        title: event.title,
        url: event.registrationUrl,
        occurredAt: event.startsAt,
        payload: { eventId: event.id, eventType: event.type, startsAt: event.startsAt.toISOString(), language: event.language },
        ...rule([
          [event.public, 'Event is not public'],
          [event.registrationOpen && safeLink(event.registrationUrl), 'Registration is closed or has no HTTPS link'],
          [event.startsAt <= horizon, `More than ${UPCOMING_DAYS} days after the send date`],
        ]),
      })),
      ...recent.map((event) => ({
        sourceSystem: event.externalId ? 'event_hub' : 'manual_event',
        sourceRef: event.externalId ?? event.id,
        type: 'recent_event' as const,
        title: event.title,
        url: event.recordingUrl ?? event.photosUrl,
        occurredAt: event.startsAt,
        payload: { eventId: event.id, eventType: event.type, recordingUrl: event.recordingUrl, photosUrl: event.photosUrl },
        ...rule([[event.mediaPublic && (safeLink(event.recordingUrl) || safeLink(event.photosUrl)), 'No recording or photos marked public']]),
      })),
    ];
  }

  private async library(since: Date): Promise<NewItem[]> {
    const resources = await this.deps.library.listResourcesAddedSince(since);
    return resources.map((resource) => ({
      sourceSystem: 'academy_library',
      sourceRef: resource.id,
      type: 'library' as const,
      title: resource.title,
      url: resource.url,
      occurredAt: new Date(resource.addedAt),
      payload: { titles: resource.titles ?? {}, tags: resource.tags },
      ...rule([
        [resource.public, 'Resource is not public'],
        [safeLink(resource.url), 'Link is not HTTPS'],
      ]),
    }));
  }

  private async graduations(since: Date): Promise<NewItem[]> {
    const graduations = await this.deps.coreEngine.listGraduationsSince(since);
    // Aggregate only: course and group size, never names (8.2).
    return graduations.map((graduation) => ({
      sourceSystem: 'core_engine',
      sourceRef: graduation.groupId,
      type: 'graduation' as const,
      title: graduation.courseTitle,
      url: null,
      occurredAt: new Date(graduation.graduatedAt),
      payload: { courseId: graduation.courseId, groupId: graduation.groupId, graduates: graduation.graduates },
      publishable: graduation.graduates > 0,
      skipReason: graduation.graduates > 0 ? null : 'No graduates reported',
    }));
  }

  private async hires(since: Date): Promise<NewItem[]> {
    const records = (await this.deps.alumni.listEmploymentChangedSince(since)).filter((record) => record.status === 'employed');
    return Promise.all(
      records.map(async (record) => {
        // Names come from the Core Engine, and only for graduates who agreed to be featured.
        const person = record.featureConsent ? await this.deps.coreEngine.getPerson(record.corePersonId) : null;
        const name = person ? `${person.firstName} ${person.lastName.slice(0, 1)}.` : 'A graduate';
        return {
          sourceSystem: 'alumni_tracker',
          sourceRef: `${record.corePersonId}:${record.startDate ?? record.updatedAt}`,
          type: 'hire' as const,
          title: record.featureConsent ? `${name}: ${record.role ?? 'new role'} at ${record.company ?? 'a new company'}` : 'Graduate hire (not featured)',
          url: null,
          occurredAt: new Date(record.updatedAt),
          payload: record.featureConsent ? { name, role: record.role, company: record.company, inTech: record.inTech } : {},
          ...rule([
            [record.featureConsent, 'Graduate did not agree to be featured'],
            [person !== null, 'Person not found in the Core Engine'],
          ]),
        };
      }),
    );
  }

  private async newGroups(since: Date, sendAt: Date): Promise<NewItem[]> {
    const groups = await this.deps.groupLaunchpad.listGroupsAnnouncedSince(since);
    return groups.map((group) => ({
      sourceSystem: 'group_launchpad',
      sourceRef: group.id,
      type: 'new_group' as const,
      title: group.courseTitle,
      url: group.applyUrl,
      occurredAt: new Date(group.announcedAt),
      payload: { titles: group.courseTitles ?? {}, startDate: group.startDate, seats: group.seats },
      ...rule([
        [group.openForApplications, 'Group is not open for applications'],
        [new Date(`${group.startDate}T00:00:00+04:00`) > sendAt, 'Starts before the send date'],
        [safeLink(group.applyUrl), 'Apply link is not HTTPS'],
      ]),
    }));
  }
}
