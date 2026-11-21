import { describe, expect, it } from 'vitest';
import type { EventHubMessage } from '../src/eventhub/contract.js';
import { EXAMPLE_MESSAGES } from '../src/eventhub/fixtures.js';
import { createIntegrations } from '../src/integrations/index.js';
import { Collectors } from '../src/newsletter/collectors.js';
import { buildTestApp, currentTestDatabase } from './helpers.js';

const example = <T extends EventHubMessage['type']>(type: T) => structuredClone(EXAMPLE_MESSAGES.find((message) => message.type === type)!) as Extract<EventHubMessage, { type: T }>;

describe('Event Hub events feed the newsletter (EVT-06)', () => {
  it('collects public upcoming events and public recordings; private events are skipped with a reason', async () => {
    const app = await buildTestApp();
    const { db } = await currentTestDatabase();
    const integrations = createIntegrations('mock');
    const collectors = new Collectors({ db, coreEngine: integrations.coreEngine, alumni: integrations.alumniTracker, library: integrations.library, groupLaunchpad: integrations.groupLaunchpad });

    await app.eventHub.process(example('event.created')); // public open day on 5 December, registration open
    const privateEvent = example('event.created');
    privateEvent.id = 'evh-msg-private';
    privateEvent.data = { ...privateEvent.data, eventId: 'evh-ev-43', title: 'Partner visit (internal)', type: 'guest_visit', public: false };
    await app.eventHub.process(privateEvent);

    // The December issue, collected in late November.
    const upcoming = await collectors.collect(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-25T00:00:00Z'), new Date('2026-12-01T10:00:00+04:00'));
    const events = upcoming.items.filter((item) => item.type === 'upcoming_event');
    expect(events.find((item) => item.sourceRef === 'evh-ev-42')).toMatchObject({ sourceSystem: 'event_hub', publishable: true, url: 'https://events.picsart.academy/open-day-december' });
    expect(events.find((item) => item.sourceRef === 'evh-ev-43')).toMatchObject({ publishable: false, skipReason: 'Event is not public' });

    // After the event: the recording is marked public, so the January issue shows it as a recent event.
    await app.eventHub.process(example('event.updated'));
    const recent = await collectors.collect(new Date('2026-12-01T00:00:00Z'), new Date('2026-12-25T00:00:00Z'), new Date('2027-01-05T10:00:00+04:00'));
    expect(recent.items.find((item) => item.type === 'recent_event' && item.sourceRef === 'evh-ev-42')).toMatchObject({ publishable: true, url: 'https://www.youtube.com/watch?v=example' });
    await app.close();
  });
});
