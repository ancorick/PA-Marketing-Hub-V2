# Marketing Hub runbook

For the marketing manager and the admin who keep Marketing Hub running day to day. Screens are in the staff app;
"Render" means the backend service settings at render.com, "Netlify" the frontend site.

## Every week

1. **Overview → alerts panel.** Resolve or act on open alerts (failing source, paused send, DMARC unknown sender).
2. **Analytics → Data health.** Every source "Fresh". A source failing twice in a row has already alerted the
   admins in Slack and by email.
3. **Analytics → Channel taxonomy.** Map unmapped campaign values so traffic and leads land in the right channel.
4. **Analytics → Success metrics.** Check M1–M11 against their targets.
5. **Audience → Duplicates.** Merge or dismiss suggested pairs (keeps M3 under 1%).

## A data source fails

1. Data health shows the error and the last successful pull. Typical causes: an expired API token (renew it in
   the platform, update the variable in Render), a platform outage (wait; the next nightly run re-reads three days).
2. After fixing, press **Run now**, or re-run a date range ("Pull again"). Re-runs never double-count.
3. A logic change (taxonomy rule) needs no new pull: "Rebuild from raw data" for the range.
4. Ad platform API not available: download the platform's CSV export and upload it under Data health.

## A send goes wrong

- **Stop everything now:** Email settings → Kill switch. All sending stops within a minute; resume when fixed.
- **Guardrail pause** (bounces or complaints over the threshold): the send pauses itself and raises an alert.
  Check the bounced addresses and the segment before resuming; never resend to the whole list.
- **The process restarted mid-send:** nothing to do; claimed messages are never sent twice, the rest continue.

## Requests from people

- **Unsubscribe by email or phone:** open the contact → Consent → "Unsubscribe from all" (logged with your name).
- **"What do you have about me?"** contact → Export data (logged); send the file through a secure channel.
- **"Delete my data":** contact → Erase. Personal fields are cleared, the address stays on the suppression list,
  aggregates remain. It cannot be undone.

## Newsletter

The schedule drafts each issue five working days before its date and posts "Draft ready" in Slack. Edit, run the
checks, send a test to the seed list, and ask a marketing manager to approve. Changes after approval need a new
approval. The report is final seven days after sending.

## Event Hub

Until Event Hub is connected, add events and attendee CSVs on the Events page (consent columns hold the wording
version). When the Event Hub team starts: send them `backend/docs/event-hub-contract.md`, the sandbox secret first,
then `EVENT_HUB_WEBHOOK_SECRET` and `EVENT_HUB_API_KEY` from Render. Shared segments are switched on per segment.

## Deploy, migrations, rollback

- Push to the main branch: Netlify builds `frontend/`, Render builds `backend/`. Database migrations run when the
  backend starts (`backend/drizzle/`); they only add, so the previous version still runs on the new schema.
- Rollback: Render → Deploys → redeploy the previous one; Netlify → Deploys → publish the previous one.
- Health check: `GET /api/health` (database, email adapter, integrations mode).

## Secrets

Rotate a key: generate a new value in Render (Environment), save, the service restarts. Then give the new value to
the other side (ESP webhook settings, Event Hub team, Command Center). Changing `LINK_SIGNING_SECRET` breaks
unsubscribe links in email already sent: avoid it unless the secret leaked.

## Backups and restore

Neon keeps daily backups and point-in-time restore (the history depends on the plan). Test once per milestone:
create a branch from yesterday in Neon, point a staging backend at it (`DATABASE_URL`), open the app and check a
few contacts and the last send. Record the date of the test in `docs/progress.md` (NFR-S9).

## Plans

Before real sending, move the Render service to an always-on plan: on the free plan it sleeps after 15 minutes, so
unsubscribe pages are slow to wake, the send dispatcher stops and the nightly pipeline runs late.
