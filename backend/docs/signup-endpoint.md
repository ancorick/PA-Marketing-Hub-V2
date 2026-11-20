# Sign-up endpoint (AUD-20)

For website forms ("Get course news") and social lead forms forwarded by the website or an integration.
Every sign-up gets a confirmation email; consent stays `pending` until the person clicks it (AUD-08).

## Request

`POST {PUBLIC_API_URL}/api/public/signup` with `Content-Type: application/json`.
Calling it from the browser needs the website origin in the backend's `CORS_ORIGINS`.

```json
{
  "email": "anna@example.com",
  "firstName": "Anna",
  "lastName": "Petrosyan",
  "language": "hy",
  "consent": [{ "topic": "newsletter", "wordingVersion": "newsletter-hy-v1" }],
  "pageUrl": "https://academy.example/courses/python?utm_source=instagram&utm_medium=paid_social&utm_campaign=spring_2026",
  "utmSource": "instagram",
  "utmMedium": "paid_social",
  "utmCampaign": "spring_2026",
  "courseInterest": "python",
  "wantsToApply": true,
  "form": "website",
  "website": ""
}
```

| Field | Required | Notes |
|---|---|---|
| `email` | yes | Normalized; disposable providers and domains without mail records are refused (EML-12). |
| `language` | yes | `hy`, `en` or `ru`: language of the confirmation email and future email. |
| `consent` | yes | One entry per ticked box: topic (`newsletter`, `courses`, `events`, `alumni`) and the version of the exact wording shown next to it. Versions and texts: `GET /api/audience/consent-wordings` (staff) or `backend/src/consent/wordings.ts`. Never show a text without its version. |
| `pageUrl` | no | Stored with the consent record and the touchpoint. |
| `utmSource`, `utmMedium`, `utmCampaign` | no | Copy them from the page URL. Medium decides the channel (PRD 9.3): `paid_social`, `social`, `organic`, `cpc`, `email`, `offline`, `referral`, `chat`, `partner`. Missing = Search and website. |
| `courseInterest`, `wantsToApply` | no | Either one creates a lead in Navigator CRM with the same channel and campaign. |
| `form` | no | `website` (default) or `social_lead_form`. |
| `website` | no | Honeypot: render it hidden with CSS (`position:absolute;left:-9999px`, `tabindex="-1"`, `autocomplete="off"`). Bots fill it; such posts are dropped. |

Link the privacy notice next to the consent boxes: `{PUBLIC_APP_URL}/#/p/privacy` (NFR-P6).

## Responses

- `202 {"status":"check_your_inbox"}`: accepted. The same answer for new and known addresses, so the form cannot reveal who is subscribed.
- `400 {"error":"invalid_field","field":"email","message":"…"}`: show the message next to the field.
- `429`: more than 10 sign-ups a minute from one IP (NFR-S6); `Retry-After` says when to retry.

## What happens

1. The contact is found by email or created (type subscriber, source channel and campaign from the parameters, first touch now). Known contacts keep their first source.
2. A `pending` consent record per new topic is written with wording version, page URL and IP.
3. A confirmation email (transactional stream) is sent with a link valid for 7 days to `{PUBLIC_APP_URL}/#/p/confirm?t=…`.
4. A `form` touchpoint is recorded with the channel and campaign.
5. With `courseInterest` or `wantsToApply`, a lead is created in Navigator CRM.
6. The click on the link turns every pending topic into `granted`. A person who had unsubscribed is subscribed again only by this click.
