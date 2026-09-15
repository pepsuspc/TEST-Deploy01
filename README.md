# its-forms

Internal online forms + multi-step approval workflow system — replaces paper
MEMO / request forms. Full requirements: [docs/requirement.md](docs/requirement.md).

This repo currently implements **Chunk 1** of the spec: a single hardcoded
MEMO form, 1-step/1-approver approval, mock SSO, print-perfect A4 pages.

## Run it (dev)

```bash
git clone <repo-url> its-forms && cd its-forms
cp .env.example .env
docker compose up
```

Open http://localhost:3000 — you'll land on a mock login page (since
`AUTH_MODE=mock` in `.env.example`) listing 8 test employees from
`mock/org/employees.json`. Pick one to log in as them.

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

## Environment variables

See `.env.example` — every variable is commented there. The app refuses to
start (with a message listing exactly what's wrong) if a required one is
missing or invalid; see `src/config/env.js`.

## Deploying to production

_(To be filled in — see docs/requirement.md §3.1 and appendix E.2.)_

## What to back up

`its_forms` MongoDB database, and whatever directory `UPLOAD_DIR` points at.
Backups themselves are IT's responsibility, not this app's.
