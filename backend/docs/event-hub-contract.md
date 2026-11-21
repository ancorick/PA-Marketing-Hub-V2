# Event Hub → Marketing Hub integration contract, v1 (EVT-01)

Event Hub (Project 13) plugs into Marketing Hub as its fourth module (PRD section 10). This is the contract
Event Hub builds against. Machine-readable versions live next to this file:

- `docs/event-hub/schema.v1.json`: JSON Schema (draft 2020-12) of one message;
- `docs/event-hub/examples/<type>.json`: one example per message type.

Both are generated from the code (`src/eventhub/contract.ts`, `src/eventhub/fixtures.ts`) with
`npm run contract:event-hub`; a test fails if they drift.

## Delivery

- **Webhook:** `POST {PUBLIC_API_URL}/api/webhooks/event-hub`, one message per request, `Content-Type: application/json`.
  If the Core Engine team provides an event bus (PRD 16.3 question 9), the same messages go on the bus unchanged.
- **Signature:** header `x-eventhub-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` where the HMAC is computed
  with the shared secret `EVENT_HUB_WEBHOOK_SECRET` over the string `<t>.<raw request body>`. Requests older or newer
  than 5 minutes are rejected (replay protection). Same scheme as the ESP webhooks (NFR-S4).
- **Idempotency:** every message has a unique `id`. Retries repeat the same `id`; Marketing Hub processes each `id`
  once and answers `200 {"status":"duplicate"}` for repeats.
- **Responses:** `200 {"status":"processed"|"duplicate"|"ignored"}`; `400` invalid payload (not retried, fix the
  sender; the body names the field); `401` bad or missing signature; `503` secret not configured.
  Retry `5xx` and network errors with exponential backoff for at least 24 hours.
- **Order:** messages may arrive out of order. A registration or check-in for an event Marketing Hub has not seen yet
  is stored and linked when the event arrives; a check-in for an unknown registration answers `200 {"status":"ignored"}`.
- **Sandbox:** `POST /api/sandbox/event-hub/webhooks` validates and signs the same way with
  `EVENT_HUB_SANDBOX_SECRET` but writes nothing; `GET /api/sandbox/event-hub/fixtures` returns the examples (EVT-08).

## Envelope

| Field | Type | Notes |
|---|---|---|
| `id` | string ≤ 200 | idempotency key |
| `type` | enum | `event.created`, `event.updated`, `registration.created`, `registration.cancelled`, `checkin.recorded`, `event.cost_recorded` |
| `version` | `"1"` | contract version |
| `occurredAt` | ISO 8601 with offset | when it happened in Event Hub |
| `data` | object | by type, below |

## Message types

**`event.created`, `event.updated`** (newsletter upcoming and recent events, Events view). `data`: `eventId`, `title`,
`type` (`open_day`, `workshop`, `info_session`, `meetup`, `graduation`, `guest_visit`, `other`), `startsAt`, `endsAt?`,
`language?` (`hy`/`en`/`ru`), `public`, `registrationUrl?` (HTTPS), `registrationOpen`, `recordingUrl?`, `photosUrl?`,
`mediaPublic` (recording and photos may be shared publicly). `event.updated` sends the full event, not a diff.

**`registration.created`** (Audience contact, consent, touchpoint). `data`: `registrationId`, `eventId`,
`registeredAt`, `contact` {`corePersonId?`, `email`, `firstName?`, `lastName?`, `phone?`, `language?`},
`consent` [{`topic`, `wordingVersion`}], `campaign` {`utmSource?`, `utmMedium?`, `utmCampaign?`}, `pageUrl?`.

**`registration.cancelled`**: `registrationId`, `eventId`, `cancelledAt`.

**`checkin.recorded`** (touchpoint "attended", segment rules): `registrationId`, `eventId`, `checkedInAt`.

**`event.cost_recorded`** (channel cost of Events and open days): `costId`, `eventId`, `category` (`venue`, `catering`,
`materials`, `promotion`, `other`), `amount` (> 0), `currency` (ISO 4217, converted to AMD at the CBA rate of
`spentOn`), `spentOn` (date), `description?`. A corrected cost is sent again with the same `costId` and replaces it.

## Rules (PRD 10.3)

- **Matching:** the contact is matched by Core Engine person ID when present, otherwise by normalized email, with the
  same rules as AUD-04. A new person becomes a contact with source channel Events and open days and the event as
  source campaign.
- **Consent:** the registration form shows the Audience consent wording (`GET /api/integrations/event-hub/consent-wordings`)
  and sends back the `wordingVersion` of each ticked box (AUD-07). Registering is not consent: with an empty
  `consent` list the person is stored but gets no marketing email. Event Hub sends no promotional mail to
  suppressed contacts (`POST /api/integrations/event-hub/suppression-check`).
- **Messages:** confirmations and reminders are transactional and belong to Event Hub. Promotional follow-up ("apply
  for the next course") goes through Marketing Hub and respects marketing consent.
- **Attribution:** registration and check-in become touchpoints with channel `events` and the event as campaign
  (`event:<eventId>`); campaign parameters of the registration link are kept on the registration.
- **Privacy:** send only the fields above; Marketing Hub stores what it needs for the contact and the event and
  nothing else (NFR-P2).

## Versioning

New optional fields and new enum values may be added within v1; receivers ignore unknown fields. Removing or
changing a field means v2: Marketing Hub then accepts both versions for at least one milestone.
