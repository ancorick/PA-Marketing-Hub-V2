# Marketing Hub architecture

Written for the marketing team and the program staff who will run and extend Marketing Hub.

## Overview

```
 Website forms ─┐                ┌──────────────────── Marketing Hub backend (Render) ────────────────────┐
 Event Hub ─────┤ signed webhooks│  Audience: contacts, consent, suppression, segments, imports, privacy  │
 ESP ───────────┘ / public API   │  Email: domains, send gate, sends + dispatcher, webhooks, guardrails     │──► ESP (email)
                                 │  Newsletter: schedule, collectors, drafts, editor, approval, archive    │──► Slack, editors
 GA4, Meta, Google Ads ──pull──► │  Analytics: raw layer → clean tables → taxonomy → attribution → views   │
 Core Engine, CRM, Alumni ─sync─►│  Event Hub slot: contract v1, processing, Events view, sandbox          │──► Command Center
                                 │  JobRunner (in process): syncs every 15–60 min, sends every minute,     │
                                 │  nightly pipeline 03:00 Yerevan; every run logged in sync_runs          │
                                 └────────────────────────────── Postgres (Neon) ─────────────────────────┘
                                                      ▲ JSON API (role checked on every route)
                                 Staff app (Netlify, React) and public pages for contacts (#/p/…, hy/en/ru)
```

## Modules (backend/src)

| Module | Folder | PRD |
|---|---|---|
| Contacts, duplicates, merge, imports | `contacts/`, `imports/` | 6 |
| Consent, suppression, signed links, public pages | `consent/`, `links/`, `routes/public-*` | 6.3, 13.5 |
| Segments (rule builder → SQL) | `segments/` | 6.4 |
| Sending domains, send gate, warm-up | `domains/` | 7.1–7.2 |
| Campaign sends, dispatcher, kill switch, sunset, ESP events, alerts, DMARC | `sends/`, `events/`, `alerts/`, `dmarc/` | 7.3–7.5 |
| Newsletter: collectors, drafts, editor, publishing, AI assist | `newsletter/`, `ai/` | 8 |
| Analytics: pipeline, taxonomy, links, costs, attribution, views, health, metrics | `analytics/` | 9 |
| Event Hub slot: contract, processing, Events view, manual fallback, integration, sandbox | `eventhub/` | 10 |
| Integrations with Projects 1, 2, 3, 9, 11 (contract + mock) | `integrations/` | 11 |
| Scheduled jobs | `jobs/runner.ts` | 14.4 |

The frontend mirrors this: `src/pages/*` per screen, `src/ui/*` components of the design system, all API calls in
`src/lib/api.ts`.

## Key decisions

- **One Postgres, no queue service.** Jobs run in the web process (`JobRunner`); each run is a row in `sync_runs`
  with window, row counts and error. A second instance would need a Postgres advisory lock first.
- **Raw data kept unchanged** (`raw_records`, 13 months): any analytics table can be rebuilt after a rule change;
  every pull upserts by natural key, so re-runs never double-count.
- **At-most-once sending.** A delivery is claimed before the ESP call; a crash leaves it "unknown", never resent.
  Suppression and consent are checked again for every message.
- **Consent is append-only** per topic with the wording version; suppression keeps only a hash after erasure.
- **Attribution is a view, not stored**: first touch, last touch before application, 40/20/40 position-based,
  365-day lookback; unmapped and unattributed people stay visible.
- **Aggregates only outside marketing**: leadership, viewers and Command Center see counts of 1–2 people as
  "fewer than 3".
- **Contracts first for other projects**: Projects 1, 2, 3, 9, 11 have typed contracts with mocks
  (`INTEGRATIONS_MODE=mock`); Event Hub and Command Center contracts are in `backend/docs/`.

## Security model

Staff sign in through the Core Engine (mock tokens until it exists); every staff route checks the role
(test `security-routes.test.ts`). Public pages use signed, purpose-bound link tokens and rate limits. Webhooks
are HMAC-signed with a 5-minute replay window. Services (Command Center, Event Hub) use API keys. Secrets live in
Render and Netlify environment variables; logs redact credentials. Personal fields and their purpose:
`backend/docs/data-inventory.md`.
