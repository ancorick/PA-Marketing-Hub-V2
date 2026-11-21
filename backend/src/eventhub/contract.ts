import { z } from 'zod';
import { TOPICS } from '../consent/wordings.js';

/**
 * Event Hub (Project 13) → Marketing Hub contract, version 1 (PRD 10.2, 10.3, EVT-01). Event Hub builds against
 * these schemas; docs/event-hub-contract.md describes them for people and docs/event-hub/schema.v1.json is the
 * generated JSON Schema. Additive changes stay in v1; anything else becomes v2 with both accepted for a while.
 */
export const EVENT_HUB_CONTRACT_VERSION = '1';

export const MESSAGE_TYPES = ['event.created', 'event.updated', 'registration.created', 'registration.cancelled', 'checkin.recorded', 'event.cost_recorded'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const EVENT_TYPES = ['open_day', 'workshop', 'info_session', 'meetup', 'graduation', 'guest_visit', 'other'] as const;
export const COST_CATEGORIES = ['venue', 'catering', 'materials', 'promotion', 'other'] as const;

const id = z.string().min(1).max(200);
const instant = z.iso.datetime({ offset: true });
const https = z.url({ protocol: /^https$/ }).max(2000);
const language = z.enum(['hy', 'en', 'ru']);

export const eventData = z.object({
  eventId: id.describe('Event Hub event ID; stable for the life of the event'),
  title: z.string().min(1).max(300),
  type: z.enum(EVENT_TYPES),
  startsAt: instant,
  endsAt: instant.nullish(),
  language: language.nullish().describe('Main language of the event; null for mixed'),
  public: z.boolean().describe('Listed publicly; only public events reach the newsletter'),
  registrationUrl: https.nullish(),
  registrationOpen: z.boolean(),
  recordingUrl: https.nullish(),
  photosUrl: https.nullish(),
  mediaPublic: z.boolean().default(false).describe('Recording and photos may be shared publicly (newsletter "recent events")'),
});

export const registrationData = z.object({
  registrationId: id,
  eventId: id,
  registeredAt: instant,
  contact: z.object({
    corePersonId: id.nullish().describe('Core Engine person ID when Event Hub knows it; matched first (AUD-04)'),
    email: z.email().max(320),
    firstName: z.string().max(100).nullish(),
    lastName: z.string().max(100).nullish(),
    phone: z.string().max(40).nullish(),
    language: language.nullish(),
  }),
  consent: z
    .array(z.object({ topic: z.enum(TOPICS), wordingVersion: z.string().min(1).max(60).describe('Version of the Audience wording shown on the form (AUD-07)') }))
    .max(4)
    .default([])
    .describe('Boxes the person ticked; empty = no marketing consent given (the registration itself is not consent)'),
  campaign: z
    .object({ utmSource: z.string().max(200).nullish(), utmMedium: z.string().max(200).nullish(), utmCampaign: z.string().max(200).nullish() })
    .default({})
    .describe('Campaign parameters of the registration link'),
  pageUrl: https.nullish(),
});

export const cancellationData = z.object({ registrationId: id, eventId: id, cancelledAt: instant });
export const checkinData = z.object({ registrationId: id, eventId: id, checkedInAt: instant });
export const costData = z.object({
  costId: id.describe('Stable ID of the cost line; a corrected amount is sent again with the same costId'),
  eventId: id,
  category: z.enum(COST_CATEGORIES),
  amount: z.number().positive().max(1e10),
  currency: z.string().regex(/^[A-Z]{3}$/),
  spentOn: z.iso.date(),
  description: z.string().max(300).nullish(),
});

const envelope = <T extends MessageType, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    id: id.describe('Idempotency key: unique per message; a retry repeats it and Marketing Hub processes it once'),
    type: z.literal(type),
    version: z.literal(EVENT_HUB_CONTRACT_VERSION),
    occurredAt: instant,
    data,
  });

export const messageSchema = z.discriminatedUnion('type', [
  envelope('event.created', eventData),
  envelope('event.updated', eventData),
  envelope('registration.created', registrationData),
  envelope('registration.cancelled', cancellationData),
  envelope('checkin.recorded', checkinData),
  envelope('event.cost_recorded', costData),
]);
export type EventHubMessage = z.infer<typeof messageSchema>;

/** The JSON Schema published for Event Hub (draft 2020-12). */
export const contractJsonSchema = () => ({
  $id: 'urn:picsart-academy:marketing-hub:event-hub:v1',
  title: 'Event Hub to Marketing Hub message, v1',
  ...z.toJSONSchema(messageSchema, { io: 'input' }),
});
