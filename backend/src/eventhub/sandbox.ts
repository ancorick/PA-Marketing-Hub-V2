import { findWording } from '../consent/wordings.js';
import type { EventHubMessage } from './contract.js';
import { eventCampaignKey } from './service.js';

/**
 * Sandbox for the Event Hub team (EVT-08): the same signature and schema checks as the real webhook, then a
 * description of what Marketing Hub would do. Nothing is written and no production data is read; repeated IDs
 * are remembered in memory only, so idempotency can be tried too.
 */
export class EventHubSandbox {
  private readonly seen = new Set<string>();

  check(message: EventHubMessage): { status: 'valid' | 'duplicate'; type: string; wouldDo: string[]; warnings: string[] } {
    if (this.seen.has(message.id)) return { status: 'duplicate', type: message.type, wouldDo: ['Nothing: this id was already processed (a retry)'], warnings: [] };
    if (this.seen.size > 5000) this.seen.clear();
    this.seen.add(message.id);
    const warnings: string[] = [];
    const wouldDo: string[] = [];
    const campaign = (eventId: string) => eventCampaignKey({ externalId: eventId, id: eventId });
    switch (message.type) {
      case 'event.created':
      case 'event.updated': {
        const event = message.data;
        wouldDo.push(`Create or update event ${event.eventId} "${event.title}" (${event.type}) on ${event.startsAt}`);
        wouldDo.push(
          event.public && event.registrationOpen && event.registrationUrl
            ? 'Offer it to the newsletter as an upcoming event when it is within 45 days of an issue'
            : 'Not offered as an upcoming event (needs public, registration open and an HTTPS registration URL)',
        );
        if (event.mediaPublic && (event.recordingUrl || event.photosUrl)) wouldDo.push('Offer the recording or photos to the newsletter as a recent event');
        if (!event.public && event.mediaPublic) warnings.push('mediaPublic is true on a private event: the newsletter only uses public events');
        break;
      }
      case 'registration.created': {
        const { contact, consent, campaign: utm } = message.data;
        wouldDo.push(`Match the contact by ${contact.corePersonId ? `Core Engine person ${contact.corePersonId}, then ` : ''}email ${contact.email}; create one if none (source: Events and open days, campaign ${campaign(message.data.eventId)})`);
        if (consent.length === 0) wouldDo.push('Record no marketing consent (registering is not consent)');
        for (const item of consent) {
          const wording = findWording(item.wordingVersion);
          if (!wording || wording.topic !== item.topic) warnings.push(`Unknown consent wording ${item.wordingVersion} for ${item.topic}: it would be skipped. Use GET /api/integrations/event-hub/consent-wordings`);
          else wouldDo.push(`Record ${item.topic} consent granted with wording ${item.wordingVersion}`);
        }
        if (utm.utmSource || utm.utmMedium) wouldDo.push(`Record a touch from the registration link (${utm.utmSource ?? '-'} / ${utm.utmMedium ?? '-'}) one second before the registration`);
        wouldDo.push(`Record a registration touchpoint in Events and open days, campaign ${campaign(message.data.eventId)}`);
        break;
      }
      case 'registration.cancelled':
        wouldDo.push(`Mark registration ${message.data.registrationId} cancelled (ignored if Marketing Hub never received it)`);
        break;
      case 'checkin.recorded':
        wouldDo.push(`Mark registration ${message.data.registrationId} checked in and record an attendance touchpoint (ignored for an unknown registration)`);
        break;
      case 'event.cost_recorded':
        wouldDo.push(
          `Record ${message.data.amount} ${message.data.currency} (${message.data.category}) on ${message.data.spentOn} as an Events and open days cost of campaign ${campaign(message.data.eventId)}, converted to AMD at the CBA rate; a resend with costId ${message.data.costId} replaces it`,
        );
        break;
    }
    return { status: 'valid', type: message.type, wouldDo, warnings };
  }
}
