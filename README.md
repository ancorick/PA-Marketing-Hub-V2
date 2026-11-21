# Marketing Hub (Picsart Academy, Project 12)

One place for the Academy's marketing: a deduplicated contact base with consent (Audience), campaign email
and the monthly newsletter from authenticated domains (Email, Newsletter), analytics that measure channels by
who enrolls and gets hired (Analytics), and a ready slot for Event Hub (Project 13). Requirements: `docs/prd.md`.

| Part | Stack | Hosting |
|---|---|---|
| `frontend/` | React 19, Vite, TypeScript, TanStack Query; design system in `frontend/design-system/` | Netlify (`netlify.toml`) |
| `backend/` | Node 24, Fastify 5, TypeScript, Zod, Drizzle ORM | Render (`render.yaml`), Postgres on Neon (Frankfurt) |

More: [architecture](docs/architecture.md) · [runbook](docs/runbook.md) · [progress and open items](docs/progress.md) ·
contracts in `backend/docs/` (Event Hub, Command Center, sign-up form, personal data inventory).

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
chooses viewer, editor, marketing manager, admin or leadership.

Demo data: start the backend with `DEMO_SEED=true npm run dev` (or set it in `backend/.env`) to load a synthetic
data set into an empty database: about 1,800 made-up contacts in hy/en/ru over 18 months, costs and exchange
rates, events, three newsletter issues, campaign sends, sync runs, alerts and unmapped utm values
(`backend/src/demo/`). A database that already has contacts is never touched, and `NODE_ENV=production` refuses
the flag at start-up. With the embedded database the set is rebuilt on every start; the same day gives the same data.

## Checks

```sh
cd backend && npm run typecheck && npm test && npm run build   # ~250 tests, embedded Postgres per test file
cd frontend && npm run build                                    # type check + production bundle
```

## Configuration

All secrets are environment variables (Render, Netlify), never in the repository; `backend/.env.example` and
`frontend/.env.example` describe every variable. Render generates the signing secrets and API keys
(`LINK_SIGNING_SECRET`, `ESP_WEBHOOK_SECRET`, `EVENT_HUB_*`, `COMMAND_CENTER_API_KEY`); the values to fill in by hand
are the public URLs, the sending identity (`MAIL_FROM`, `ACADEMY_POSTAL_ADDRESS`), `DATABASE_URL`, Slack and alert
addresses, and the Claude API key for the newsletter writing assistant.

## What still needs people

See "Что нужно от пользователя" under "Ручные задачи пользователя" in `docs/progress.md`: the email service and DNS for the sending domain, API
access to ad and analytics platforms, the real APIs of Projects 1, 2, 11 and 13, deploy on paid always-on plans,
legal review and answers to the open questions in PRD 16.3.
