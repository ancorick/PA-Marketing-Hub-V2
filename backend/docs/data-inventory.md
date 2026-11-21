# Personal data inventory (NFR-P1, NFR-P2)

Marketing Hub collects only the fields of the data model (PRD 12). Every field that holds or points to a person is
listed here with its purpose and retention. **A new personal field needs a row here first**: the test
`test/privacy-inventory.test.ts` fails when a column of these tables is not listed.

Legal basis and wording: consent per topic (PRD 6.3) with the wording version shown; the privacy page
(`#/p/privacy`, hy/en/ru) explains it to contacts. Erasure (AUD-18) nulls personal fields, keeps the email hash in
suppressions and keeps touchpoints and outcomes without personal fields for aggregate reporting (PRD 12.4).

## contacts

| Column | Purpose | Retention |
|---|---|---|
| id | internal key | until erasure (then anonymous row) |
| corePersonId | link to the Academy person record (AUD-06) | as the contact; nulled on erasure |
| email | sending marketing email the person agreed to | as the contact; nulled on erasure |
| emailKey | duplicate detection (AUD-04) | as the contact; nulled on erasure |
| importId | which import created the contact (consent evidence, bounce review) | as the contact |
| crmLeadId | link to the Navigator CRM lead (AUD-06) | as the contact; nulled on erasure |
| crmStage | keep active applicants out of recruitment sends (AUD-17) | as the contact |
| selfReportedSource | "How did you hear about us?" for the tracking check (ANL-16) | as the contact; nulled on erasure |
| employmentStatus | alumni segments and hired outcomes (Alumni Tracker) | as the contact |
| reengagementSentAt | sunset policy (EML-15) | as the contact |
| sunsetAt | sunset policy (EML-15) | as the contact |
| phone | optional contact detail from forms and the CRM | as the contact; nulled on erasure |
| firstName | greeting in email | as the contact; nulled on erasure |
| lastName | telling people apart in the staff interface | as the contact; nulled on erasure |
| language | language of email and pages | as the contact |
| type | subscriber, lead, applicant, student, alumni (segments) | as the contact |
| sourceChannel | first channel, for attribution (PRD 9.4) | as the contact |
| sourceCampaign | first campaign, for attribution | as the contact |
| firstTouchAt | cohorts by month of first touch (PRD 9.5) | as the contact |
| tags | staff segmentation | as the contact |
| status | whether email may be sent (mirrors suppression) | as the contact |
| frequency | "monthly at most" preference (AUD-11) | as the contact |

## consentRecords (append-only, PRD 12.4)

| Column | Purpose | Retention |
|---|---|---|
| id, contactId | key and owner | as the contact |
| topic, state, method | what was agreed or withdrawn, and how | kept as evidence |
| wordingVersion | exact wording the person saw (AUD-07) | kept as evidence |
| sourceUrl | page the consent was given on | kept as evidence; nulled on erasure |
| ip | evidence of a web form consent (6.3) | kept as evidence; nulled on erasure |
| actorId, reason | who changed it manually and why (6.3 rule 5) | kept as evidence |

## suppressions

| Column | Purpose | Retention |
|---|---|---|
| id | key | permanent |
| emailHash | never email the address again, even after erasure (SHA-256, not the address) | permanent |
| reason, source | why and where (unsubscribe, bounce, complaint, erasure) | permanent |
| liftedAt, liftSource | the person opted in again | permanent |

## touchpoints

| Column | Purpose | Retention |
|---|---|---|
| id, contactId | key and owner (after erasure the owner is an anonymous row) | aggregate reporting |
| channel, campaign, type, occurredAt | attribution (PRD 9.4) | aggregate reporting |
| sourceSystem, sourceRef | idempotent re-imports | aggregate reporting |
| utmSource, utmMedium | remapping after a taxonomy rule is added (ANL-03) | aggregate reporting |

## deliveries

| Column | Purpose | Retention |
|---|---|---|
| id, sendId, contactId | which person got which send | send reports |
| email | address the message went to (the contact may change it later) | send reports; nulled on erasure |
| status, variant, skipReason, attempts, nextAttemptAt, lastError | sending pipeline and A/B tests | send reports |
| espMessageId | matching ESP webhooks (EML-04) | send reports |
| sentAt, deliveredAt, openedAt, firstClickAt, unsubscribedAt | reports, guardrails, sunset policy | send reports |

## linkClicks

| Column | Purpose | Retention |
|---|---|---|
| id, deliveryId, sendId, contactId | which click belongs to which send and person | issue reports |
| url, blockId, occurredAt | clicks per newsletter block (NWS-13) | issue reports |

## eventRegistrations

| Column | Purpose | Retention |
|---|---|---|
| id, externalId, eventExternalId, eventId, contactId | registration and its event (EVT-03) | as the event |
| status, registeredAt, cancelledAt, checkedInAt | Events view and attendance touchpoints (EVT-05) | as the event |
| utmSource, utmMedium, utmCampaign | campaign of the registration link (attribution) | as the event |
| source | Event Hub, CSV or manual entry | as the event |

## Not stored

No passwords (staff sign in through the Core Engine), no payment data, no third-party cookies or cross-site
identifiers (NFR-P7): campaign attribution uses first-party links and campaign parameters only. Raw analytics
responses hold aggregate website, social and ad data, not people (kept 13 months).
