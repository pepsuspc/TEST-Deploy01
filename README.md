# its-forms

Internal online forms + multi-step approval workflow system — replaces paper
MEMO / request forms. Full requirements: [docs/requirement.md](docs/requirement.md).

This repo currently implements **Chunk 1** of the spec (milestone M1): a
single hardcoded MEMO form, a real 2-step approval workflow (submitter's
chief, then a fixed second approver), mock + real SSO, print-perfect A4
pages, inbox, notifications, and audit logging. See "What's in Chunk 1" below
for the exact feature list, and docs/requirement.md §14 for what's still
ahead in chunks 2–4.

## Run it (dev)

```bash
git clone <repo-url> its-forms && cd its-forms
cp .env.example .env
docker compose up
```

Open http://localhost:3000 — you'll land on a mock login page (since
`AUTH_MODE=mock` in `.env.example`) listing the test employees from
`mock/org/employees.json` (8 active + 1 deactivated, for testing rejected
logins). Pick one to log in as them. The employee(s) listed in
`ADMIN_EMP_IDS` become admin the first time they're synced (login, or the
org sync job) — see `.env.example`.

**If you add/update an npm dependency**, the dev compose file bind-mounts
your working tree over `/app` for hot-editing, with `node_modules` kept as
its own anonymous Docker volume so your host's `node_modules` doesn't shadow
what got installed in the image. That volume does **not** auto-refresh on
`docker compose up --build` — rebuild AND recreate it explicitly:

```bash
docker compose up -d --build -V   # -V renews anonymous volumes
```

Otherwise the container keeps running against whatever `node_modules` existed
the first time you ever ran `docker compose up`, silently missing anything
added since (this bit us once already — see git log).

## Run it without Docker

Needs Node.js 20+ and a MongoDB 5.0 instance reachable at `MONGODB_URI`.

```bash
npm install
cp .env.example .env   # edit MONGODB_URI to point at your own mongod
npm run dev
```

## Tests

```bash
npm test
```

Some tests (e.g. the doc-number counter, the concurrent-approval race) talk
to a real MongoDB rather than a fake, because the thing being tested is
concurrency-safety under real writes. Have `docker compose up` (or any
MongoDB) running first; by default tests connect to
`mongodb://localhost:27017/its_forms_test` — override with `TEST_MONGODB_URI`
if yours is elsewhere.

## Environment variables

See `.env.example` — every variable is commented there. The app refuses to
start (with a message listing exactly what's wrong, not a stack trace) if a
required one is missing or invalid; see `src/config/env.js`.

## Creating the first admin

Admin is a role, not a login: set the employee's `emp_id` in `ADMIN_EMP_IDS`
(comma-separated for more than one) in `.env` *before* they first log in or
get synced from the org API — that's when the role gets attached. Admin
management UI (promoting people after the fact) is chunk 4; for now, adding
someone later means adding their `emp_id` to `ADMIN_EMP_IDS` and re-syncing.

## Folder structure

```
src/
  server.js, app.js       entrypoint + Express app wiring
  config/env.js           .env loading + fail-fast validation
  db/                     Mongo connection + idempotent index creation
  auth/                   session cookie, mock login, real SSO
  org/                    sellcenter org-chart API client + daily sync
  domain/                 pure business logic (unit tested): evaluateStep,
                           humanizeDuration, docNumber, validateField,
                           thaiDate, the hardcoded MEMO field/workflow defs
  models/                 thin MongoDB collection helpers (not an ORM)
  routes/                 Express route handlers
  views/                  EJS templates (server-rendered, no frontend framework)
  public/                 CSS/JS/fonts served as-is
mock/org/                 appendix A's mock employee/department data
test/                     node:test suites
docs/requirement.md       the full spec this app is built against
```

## Deploying to production

IT deploys from GitHub — this app is never deployed by the developer
(docs/requirement.md §2 row 8, §3.1). From the server, with `.env` already
in place (`MONGODB_URI` pointing at `digital.in.th`, real `AUTH_MODE=sso`
and `ORG_API_TOKEN`, `ORG_API_MOCK=0`):

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

`docker-compose.prod.yml` has no `mongo` service (production Mongo is IT's,
outside this repo) and no source bind-mount (the image is self-contained —
rebuild to pick up new code, don't edit files in the running container).

Before the very first production login works, IT needs to have already
created the real MongoDB user (appendix E.1) and gotten a real
`ORG_API_TOKEN` — see docs/requirement.md §2 for exactly what's needed from
IT and what to use as a fallback while waiting on it.

## What to back up

The `its_forms` MongoDB database, and whatever host path is bind-mounted to
`/data/uploads` in `docker-compose.prod.yml` (`UPLOAD_DIR` inside the
container). Chunk 1 doesn't use file uploads yet (that's chunk 2's `file`
field type), so today there's nothing under that path — but the mount and
this note exist now so nothing has to change later. Backups themselves are
IT's responsibility, not this app's (docs/requirement.md §13).

## What's in Chunk 1

- SSO: real flow per §5 (code-complete, not live-tested against a real
  sellcenter — see `src/auth/sso.js`) + a mock login for dev
  (`AUTH_MODE=mock`)
- One hardcoded MEMO form: เรื่อง, เรียน, วันที่ (auto), a 5-option
  checkbox row, รายละเอียด — rendered on an actual A4-proportioned page in
  both edit and view modes, with self-hosted Sarabun for print
- A real 2-step approval workflow: submitter's direct chief (resolved from
  live org-chart data), then a fixed second approver — submit, save draft
  + autosave, validate, approve/reject/return, recall (both "submitter
  before anyone acts" and "approver after acting, before the next step
  moves"), cancel, resubmit-from-a-finished-one
- Optimistic concurrency on every write (§8.9) — the version guard uses
  what the browser's page actually rendered, not a version re-read at
  request time; see the commit history for why that distinction mattered
- Inbox (รอฉันอนุมัติ / คำร้องของฉัน), a per-submission timeline +
  comments, in-app notifications (bell, 30s poll), append-only audit log
  (no browsing UI for it yet)
- 403 on an uninvolved employee opening someone else's submission by URL;
  XSS-safe field rendering everywhere

**Not yet built** (chunks 2–4): the drag-drop form designer and the other 9
field types, N-of-M multi-approver quorum and `submitter_choice`, file
attachments, per-step deadlines, email notifications, CSV export, the
admin/audit-log UI, mobile layout pass, and the full §12 security-hardening
checklist (CSRF tokens, rate limiting, security headers, `npm audit` gate).
