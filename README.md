# Marketing Hub (Picsart Academy, Project 12)

One place for the Academy's marketing: a deduplicated contact base with consent (Audience), campaign email
and the monthly newsletter from authenticated domains (Email, Newsletter), analytics that measure channels by
who enrolls and gets hired (Analytics), and a ready slot for Event Hub (Project 13). Built for the Picsart Academy
Student Fellowship Program; the requirements document is kept outside this repository.

| Part | Stack | Hosting |
|---|---|---|
| `frontend/` | React 19, Vite, TypeScript, TanStack Query; design system in `frontend/design-system/` | Netlify (`netlify.toml`) |
| `backend/` | Node 24, Fastify 5, TypeScript, Zod, Drizzle ORM | Render (`render.yaml`), Postgres on Neon (Frankfurt) |

More: [architecture](docs/architecture.md) · [runbook](docs/runbook.md) · contracts in `backend/docs/` (Event Hub, Command Center, sign-up form, personal data inventory).

## Run it locally

```sh
# backend: http://localhost:4000. Without DATABASE_URL an embedded Postgres (PGlite) starts with mock integrations.
cd backend
cp .env.example .env        # optional; defaults work for development
npm install
npm run dev

# frontend: http://localhost:5173
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:4000
npm install
npm run dev
```

Sign-in uses mock staff tokens until the Core Engine (Project 1) is connected: the role switcher in the header
chooses viewer, editor, marketing manager, admin or leadership. The interface is in Armenian, English and Russian,
with dark and light themes.

Demo data: start the backend with `DEMO_SEED=true npm run dev` (or set it in `backend/.env`) to load a synthetic
data set into an empty database: about 1,800 made-up contacts in hy/en/ru over 18 months, costs and exchange
rates, events, three newsletter issues, campaign sends, sync runs, alerts and unmapped utm values
(`backend/src/demo/`). A database that already has contacts is never touched, and `NODE_ENV=production` refuses
the flag at start-up. With the embedded database the set is rebuilt on every start; the same day gives the same data.

## Demo deploy (Render + Netlify)

The public demo runs only synthetic data. `render.yaml` is the demo Blueprint (`DEMO_MODE`, `DEMO_SEED`, mock
sign-in, emails to the log and the Dev inbox); `render.production.yaml` is kept for the real site.

1. **Neon:** create a project only for the demo (region Frankfurt) and copy its connection string.
2. **Render:** New → Blueprint → this repository. Enter `DATABASE_URL` (the demo Neon string); leave
   `CORS_ORIGINS` and `PUBLIC_APP_URL` empty for now. The first start loads the demo data set (about a minute).
   Check `https://<service>.onrender.com/api/health`.
3. **Netlify:** Add new site → Import from GitHub → this repository (settings come from `netlify.toml`).
   Add the environment variable `VITE_API_URL=https://<service>.onrender.com` and deploy.
4. **Render again:** set `CORS_ORIGINS` and `PUBLIC_APP_URL` to the Netlify URL (`https://<site>.netlify.app`);
   the service redeploys.

The free Render plan sleeps after 15 minutes without visits; the first page then waits about a minute. The demo
database keeps visitors' changes; to start over, empty the Neon database (or create a new branch) and restart.

## Checks

```sh
cd backend && npm run typecheck && npm test && npm run build   # ~270 tests, embedded Postgres per test file
cd frontend && npm run build                                    # type check + production bundle
```

## Configuration

All secrets are environment variables (Render, Netlify), never in the repository; `backend/.env.example` and
`frontend/.env.example` describe every variable. Render generates the signing secrets and API keys
(`LINK_SIGNING_SECRET`, `ESP_WEBHOOK_SECRET`, `EVENT_HUB_*`, `COMMAND_CENTER_API_KEY`); the values to fill in by hand
are the public URLs, the sending identity (`MAIL_FROM`, `ACADEMY_POSTAL_ADDRESS`), `DATABASE_URL`, Slack and alert
addresses, and the Claude API key for the newsletter writing assistant.

## What still needs people

Before real sending and reporting: the email service and DNS for the sending domain, API
access to ad and analytics platforms, the real APIs of Projects 1, 2, 11 and 13, deploy on paid always-on plans,
legal review and answers to the open questions of the requirements (PRD 16.3).
