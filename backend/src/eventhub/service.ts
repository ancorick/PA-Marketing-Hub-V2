import { and, eq, isNull } from 'drizzle-orm';
import type { ChannelTaxonomy } from '../analytics/taxonomy.js';
import type { CostService } from '../analytics/costs.js';
import { slug } from '../analytics/links.js';
import type { ConsentService } from '../consent/service.js';
import { findWording } from '../consent/wordings.js';
import { normalizeEmail, normalizeName, normalizePhone } from '../contacts/fields.js';
import type { Contact, ContactRepository } from '../contacts/repository.js';
import type { ContactService } from '../contacts/service.js';
import type { AppPgDatabase } from '../db/client.js';
import { eventHubMessages, eventRegistrations, events } from '../db/schema.js';
import type { TouchpointRepository } from '../touchpoints/repository.js';
import type { EventHubMessage } from './contract.js';

export const EVENT_HUB_ACTOR = 'event_hub';

/** Campaign key of an event (EVT-04): "event-<id>", the same for touchpoints, costs and the Events view. */
export const eventCampaignKey = (event: { externalId: string | null; id: string }) => slug(`event-${event.externalId ?? event.id}`);
const externalCampaignKey = (eventExternalId: string) => slug(`event-${eventExternalId}`);

export type ProcessResult = { status: 'processed' | 'duplicate' | 'ignored'; detail?: string; warnings?: string[] };

type Deps = {
  db: AppPgDatabase;
  contacts: ContactService;
  contactRepository: Pick<ContactRepository, 'findByEmail' | 'findByCorePersonId' | 'findById' | 'update'>;
  consent: Pick<ConsentService, 'record'>;
  touchpoints: Pick<TouchpointRepository, 'recordOnce'>;
  taxonomy: Pick<ChannelTaxonomy, 'mapUtm'>;
  costs: Pick<CostService, 'upsertExternal'>;
  logger: { warn: (obj: object, msg: string) => void };
};

const safePhone = (phone: string | null | undefined) => {
  try {
    return normalizePhone(phone ?? null);
  } catch {
    return null;
  }
};

/**
 * Processes Event Hub messages (PRD 10.3, EVT-02 to EVT-04). Each idempotency key is handled once; events are
 * upserted, registrations create or update an Audience contact with the consent the person gave, and
 * registration and check-in become touchpoints in the Events and open days channel with the event as campaign.
 */
export class EventHubService {
  constructor(private readonly deps: Deps) {}

  /** Handles one message once per idempotency key. */
  async process(message: EventHubMessage): Promise<ProcessResult> {
    const [claimed] = await this.deps.db
      .insert(eventHubMessages)
      .values({ id: message.id, type: message.type, status: 'processing', occurredAt: new Date(message.occurredAt) })
      .onConflictDoNothing()
      .returning({ id: eventHubMessages.id });
    if (!claimed) return { status: 'duplicate' };
    let result: ProcessResult;
    try {
      result = await this.handle(message);
    } catch (error) {
      // Not processed: free the key so Event Hub's retry is handled.
      await this.deps.db.delete(eventHubMessages).where(eq(eventHubMessages.id, message.id));
      throw error;
    }
    await this.deps.db
      .update(eventHubMessages)
      .set({ status: result.status, detail: [result.detail, ...(result.warnings ?? [])].filter(Boolean).join('; ') || null })
      .where(eq(eventHubMessages.id, message.id));
    return result;
  }

  private async handle(message: EventHubMessage): Promise<ProcessResult> {
    switch (message.type) {
      case 'event.created':
      case 'event.updated':
        return this.upsertEvent(message.data);
      case 'registration.created':
        return this.register(message.data);
      case 'registration.cancelled': {
        const updated = await this.deps.db
          .update(eventRegistrations)
          .set({ status: 'cancelled', cancelledAt: new Date(message.data.cancelledAt) })
          .where(eq(eventRegistrations.externalId, message.data.registrationId))
          .returning({ id: eventRegistrations.id });
        return updated.length ? { status: 'processed' } : { status: 'ignored', detail: `Unknown registration ${message.data.registrationId}` };
      }
      case 'checkin.recorded':
        return this.checkIn(message.data);
      case 'event.cost_recorded': {
        const data = message.data;
        await this.deps.costs.upsertExternal(
          `event_hub:${data.costId}`,
          {
            channel: 'events',
            campaign: externalCampaignKey(data.eventId),
            description: `${data.category[0]!.toUpperCase()}${data.category.slice(1)}${data.description ? `: ${data.description}` : ''} (Event Hub)`,
            dateFrom: data.spentOn,
            dateTo: data.spentOn,
            amount: data.amount,
            currency: data.currency,
          },
          EVENT_HUB_ACTOR,
        );
        return { status: 'processed' };
      }
    }
  }

  private async upsertEvent(data: Extract<EventHubMessage, { type: 'event.created' }>['data']): Promise<ProcessResult> {
    const values = {
      externalId: data.eventId,
      title: data.title,
      type: data.type,
      language: data.language ?? null,
      startsAt: new Date(data.startsAt),
      public: data.public,
      registrationUrl: data.registrationUrl ?? null,
      registrationOpen: data.registrationOpen,
      recordingUrl: data.recordingUrl ?? null,
      photosUrl: data.photosUrl ?? null,
      mediaPublic: data.mediaPublic,
    };
    const { externalId: _externalId, ...set } = values;
    const [row] = await this.deps.db.insert(events).values(values).onConflictDoUpdate({ target: events.externalId, set }).returning({ id: events.id });
    // Registrations that arrived before their event (10.3: order is not guaranteed).
    await this.deps.db
      .update(eventRegistrations)
      .set({ eventId: row!.id })
      .where(and(eq(eventRegistrations.eventExternalId, data.eventId), isNull(eventRegistrations.eventId)));
    return { status: 'processed' };
  }

  private async register(data: Extract<EventHubMessage, { type: 'registration.created' }>['data']): Promise<ProcessResult> {
    const warnings: string[] = [];
    const registeredAt = new Date(data.registeredAt);
    const [event] = await this.deps.db.select().from(events).where(eq(events.externalId, data.eventId));
    const campaign = externalCampaignKey(data.eventId);
    const contact = await this.matchOrCreate(data.contact, { campaign, registeredAt, language: data.contact.language ?? (event?.language as never) ?? 'hy' });

    for (const { topic, wordingVersion } of data.consent) {
      const wording = findWording(wordingVersion);
      if (!wording || wording.topic !== topic) {
        warnings.push(`Unknown consent wording ${wordingVersion} for ${topic}: not recorded`);
        continue;
      }
      await this.deps.consent.record(contact.id, { topics: [topic], state: 'granted', method: 'event', wordingVersion, sourceUrl: data.pageUrl ?? event?.registrationUrl ?? null }, { kind: 'person' });
    }

    const utm = { utmSource: data.campaign.utmSource?.trim() || null, utmMedium: data.campaign.utmMedium?.trim() || null, utmCampaign: data.campaign.utmCampaign?.trim() || null };
    await this.deps.db
      .insert(eventRegistrations)
      .values({ externalId: data.registrationId, eventExternalId: data.eventId, eventId: event?.id ?? null, contactId: contact.id, registeredAt, source: 'event_hub', ...utm })
      .onConflictDoUpdate({ target: eventRegistrations.externalId, set: { contactId: contact.id, status: 'registered', cancelledAt: null, registeredAt, ...utm } });

    // The link that brought them (Flow A step 6): a touch in its own channel just before the registration.
    if (utm.utmSource || utm.utmMedium) {
      const channel = await this.deps.taxonomy.mapUtm(utm.utmSource, utm.utmMedium, 'event_hub');
      if (channel !== 'events')
        await this.deps.touchpoints.recordOnce({
          contactId: contact.id,
          channel,
          campaign: utm.utmCampaign ? slug(utm.utmCampaign) : null,
          type: 'visit',
          occurredAt: new Date(registeredAt.getTime() - 1000),
          sourceSystem: 'event_hub',
          sourceRef: `${data.registrationId}:link`,
          utmSource: utm.utmSource,
          utmMedium: utm.utmMedium,
        });
    }
    await this.deps.touchpoints.recordOnce({
      contactId: contact.id,
      channel: 'events',
      campaign,
      type: 'registration',
      occurredAt: registeredAt,
      sourceSystem: 'event_hub',
      sourceRef: data.registrationId,
    });
    return { status: 'processed', ...(warnings.length && { warnings }) };
  }

  private async checkIn(data: Extract<EventHubMessage, { type: 'checkin.recorded' }>['data']): Promise<ProcessResult> {
    const checkedInAt = new Date(data.checkedInAt);
    const [registration] = await this.deps.db
      .update(eventRegistrations)
      .set({ checkedInAt })
      .where(eq(eventRegistrations.externalId, data.registrationId))
      .returning();
    if (!registration) return { status: 'ignored', detail: `Unknown registration ${data.registrationId}` };
    if (registration.contactId)
      await this.deps.touchpoints.recordOnce({
        contactId: registration.contactId,
        channel: 'events',
        campaign: externalCampaignKey(data.eventId),
        type: 'attendance',
        occurredAt: checkedInAt,
        sourceSystem: 'event_hub',
        sourceRef: `${data.registrationId}:checkin`,
      });
    return { status: 'processed' };
  }

  /** AUD-04 matching: Core Engine person ID first, then normalized email; a new person starts in Events. */
  async matchOrCreate(
    person: { corePersonId?: string | null; email: string; firstName?: string | null; lastName?: string | null; phone?: string | null },
    origin: { campaign: string; registeredAt: Date; language: 'hy' | 'en' | 'ru' },
  ): Promise<Contact> {
    const email = normalizeEmail(person.email);
    const existing = (person.corePersonId ? await this.deps.contactRepository.findByCorePersonId(person.corePersonId) : null) ?? (await this.deps.contactRepository.findByEmail(email));
    if (existing) {
      const changes = {
        ...(!existing.firstName && normalizeName(person.firstName) && { firstName: normalizeName(person.firstName) }),
        ...(!existing.lastName && normalizeName(person.lastName) && { lastName: normalizeName(person.lastName) }),
        ...(!existing.phone && safePhone(person.phone) && { phone: safePhone(person.phone) }),
      };
      return Object.keys(changes).length ? ((await this.deps.contactRepository.update(existing.id, changes, EVENT_HUB_ACTOR)) ?? existing) : existing;
    }
    const created = await this.deps.contacts.create(
      {
        email,
        firstName: person.firstName ?? null,
        lastName: person.lastName ?? null,
        phone: safePhone(person.phone),
        language: origin.language,
        sourceChannel: 'events',
        sourceCampaign: origin.campaign,
        firstTouchAt: origin.registeredAt,
        ...(person.corePersonId && { corePersonId: person.corePersonId }),
      },
      { userId: EVENT_HUB_ACTOR },
    );
    return (await this.deps.contactRepository.findById(created.id)) as Contact;
  }
}
