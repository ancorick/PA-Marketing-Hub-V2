import type { EventHubMessage } from './contract.js';

/**
 * Example messages, one per type (EVT-01), also served by the sandbox as test fixtures (EVT-08). Synthetic
 * people only (example.test addresses); never real data.
 */
export const EXAMPLE_MESSAGES: EventHubMessage[] = [
  {
    id: 'evh-msg-0001',
    type: 'event.created',
    version: '1',
    occurredAt: '2026-11-01T09:00:00+04:00',
    data: {
      eventId: 'evh-ev-42',
      title: 'Open day: Frontend and Data courses',
      type: 'open_day',
      startsAt: '2026-12-05T12:00:00+04:00',
      endsAt: '2026-12-05T15:00:00+04:00',
      language: 'hy',
      public: true,
      registrationUrl: 'https://events.picsart.academy/open-day-december',
      registrationOpen: true,
      recordingUrl: null,
      photosUrl: null,
      mediaPublic: false,
    },
  },
  {
    id: 'evh-msg-0002',
    type: 'event.updated',
    version: '1',
    occurredAt: '2026-12-06T10:00:00+04:00',
    data: {
      eventId: 'evh-ev-42',
      title: 'Open day: Frontend and Data courses',
      type: 'open_day',
      startsAt: '2026-12-05T12:00:00+04:00',
      endsAt: '2026-12-05T15:00:00+04:00',
      language: 'hy',
      public: true,
      registrationUrl: 'https://events.picsart.academy/open-day-december',
      registrationOpen: false,
      recordingUrl: 'https://www.youtube.com/watch?v=example',
      photosUrl: 'https://photos.picsart.academy/open-day-december',
      mediaPublic: true,
    },
  },
  {
    id: 'evh-msg-0003',
    type: 'registration.created',
    version: '1',
    occurredAt: '2026-11-10T18:30:00+04:00',
    data: {
      registrationId: 'evh-reg-9001',
      eventId: 'evh-ev-42',
      registeredAt: '2026-11-10T18:30:00+04:00',
      contact: { corePersonId: null, email: 'ani.sample@example.test', firstName: 'Ani', lastName: 'Sample', phone: '+37491000000', language: 'hy' },
      consent: [
        { topic: 'events', wordingVersion: 'events-hy-v1' },
        { topic: 'newsletter', wordingVersion: 'newsletter-hy-v1' },
      ],
      campaign: { utmSource: 'instagram', utmMedium: 'paid_social', utmCampaign: 'open-day-december' },
      pageUrl: 'https://events.picsart.academy/open-day-december',
    },
  },
  {
    id: 'evh-msg-0004',
    type: 'registration.cancelled',
    version: '1',
    occurredAt: '2026-12-01T08:00:00+04:00',
    data: { registrationId: 'evh-reg-9002', eventId: 'evh-ev-42', cancelledAt: '2026-12-01T08:00:00+04:00' },
  },
  {
    id: 'evh-msg-0005',
    type: 'checkin.recorded',
    version: '1',
    occurredAt: '2026-12-05T12:07:00+04:00',
    data: { registrationId: 'evh-reg-9001', eventId: 'evh-ev-42', checkedInAt: '2026-12-05T12:07:00+04:00' },
  },
  {
    id: 'evh-msg-0006',
    type: 'event.cost_recorded',
    version: '1',
    occurredAt: '2026-12-06T11:00:00+04:00',
    data: { costId: 'evh-cost-77', eventId: 'evh-ev-42', category: 'catering', amount: 180000, currency: 'AMD', spentOn: '2026-12-05', description: 'Coffee and snacks for 60 people' },
  },
];
