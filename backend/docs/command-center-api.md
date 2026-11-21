# Command Center metrics API (ANL-13)

Contract version **v1**. Marketing Hub exposes the numbers of the Overview and the Cohorts view to
Command Center (Project 15), so leadership can read them there (PRD 13.4, Flow D step 5).

- **Endpoint:** `GET {PUBLIC_API_URL}/api/v1/command-center/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&model=first_touch`
- **Auth:** header `x-api-key: <COMMAND_CENTER_API_KEY>` (service key, at least 32 characters; Render generates
  it, the admin passes it to Project 15). Staff tokens do not work here.
- **Parameters:** `from`, `to` (Yerevan dates, at most 24 months apart); `model` = `first_touch` (default),
  `last_touch` or `position_based` (PRD 9.4). One model per answer; models are never mixed.
- **Limits:** 60 requests per minute per client IP. Numbers change at most a few times a day (nightly pipeline,
  15-minute syncs), so polling once an hour is enough.
- **Privacy:** aggregates only, the same as the leadership view (PRD 4.3, NFR-P5): any count of 1 or 2 people is
  returned as the string `"fewer_than_3"`, and cost per person over such a count is `null`. No contact IDs,
  names or emails are ever returned.

## Errors

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | bad dates, range over 24 months, unknown model (`field` names the parameter) |
| 401 | `unauthorized` | missing or wrong `x-api-key` |
| 429 | `rate_limited` | over 60 requests a minute (`retry-after` header) |
| 503 | `not_configured` | `COMMAND_CENTER_API_KEY` is not set on the server |

## Response

```json
{
  "contractVersion": "v1",
  "generatedAt": "2026-11-21T06:00:00.000Z",
  "period": { "from": "2026-07-01", "to": "2026-09-30" },
  "model": "first_touch",
  "modelLabel": "First touch",
  "lookbackDays": 365,
  "currency": "AMD",
  "tiles": {
    "subscribers": 1240,
    "newsletterClickRate": { "rate": 0.061, "delivered": 3810, "previousRate": 0.055 },
    "newLeads": { "value": 412, "previous": 388 },
    "enrolledFromLeads": { "value": 37, "previous": "fewer_than_3" }
  },
  "channels": [
    { "channel": "paid_social", "lead": 160, "applied": 41, "enrolled": 19, "hired": 0, "costAmd": 2450000, "costPerLead": 15313, "costPerEnrolled": 128947 },
    { "channel": "events", "lead": 38, "applied": 9, "enrolled": "fewer_than_3", "hired": 0, "costAmd": 300000, "costPerLead": 7895, "costPerEnrolled": null },
    { "channel": "unmapped", "lead": 4, "applied": 0, "enrolled": 0, "hired": 0, "costAmd": 0, "costPerLead": 0, "costPerEnrolled": null },
    { "channel": "unattributed", "lead": 21, "applied": 3, "enrolled": 1.5, "hired": 0, "costAmd": 0, "costPerLead": 0, "costPerEnrolled": 0 }
  ],
  "totals": { "lead": 412, "applied": 90, "enrolled": 37, "hired": 0, "costAmd": 3900000, "costPerLead": 9466, "costPerEnrolled": 105405 },
  "cohorts": [
    { "month": "2026-11", "maturing": true, "people": 120, "lead": 64, "applied": 5, "enrolled": "fewer_than_3", "completed": 0, "hired": 0, "costAmd": 900000, "costPerEnrolled": null, "costPerHired": null },
    { "month": "2025-10", "maturing": false, "people": 210, "lead": 150, "applied": 31, "enrolled": 18, "completed": 15, "hired": 9, "costAmd": 1200000, "costPerEnrolled": 66667, "costPerHired": 133333 }
  ],
  "definitions": { "lead": "A contact who first expressed interest in a course in the period (CRM stage lead or later).", "…": "…" }
}
```

Field notes:

- `channel` is a slug of the taxonomy (PRD 9.3: `paid_social`, `organic_social`, `search_website`, `paid_search`,
  `email`, `events`, `referrals`, `chatbot`, `partners_press`) or `unmapped` (no taxonomy rule yet) or
  `unattributed` (no recorded touch in the 365 days before the application).
- Counts can be fractional with `position_based` (credit is shared between touches).
- `costAmd` is ad spend plus manual costs allocated to the period, in AMD; cash costs only until PRD 16.3
  question 8 is answered.
- `cohorts` are the last 24 months by month of first touch, newest first. `costPerHired` is `null` while a cohort
  is `maturing` (younger than 12 months, ANL-10).
- `hired` counts any job until PRD 16.3 question 6 decides whether only tech roles count.
- New fields may be added within v1; existing fields keep their meaning. A breaking change gets `/api/v2`.
