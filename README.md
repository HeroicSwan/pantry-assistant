# Food Pantry Operations Platform

> ⚠️ **Work in progress.** This is an actively developed portfolio/demonstration project, not production-ready software. Features, database schema, and APIs may change without notice, and it has not been deployed or hardened for real-world use. Expect rough edges. Do not use it with real household, donor, or personal data.

A full-stack web app that helps a food pantry (or a small network of pantries) run day-to-day operations: track real inventory, schedule household pickups, reserve food, forecast what's needed, and communicate with families — all with strict privacy and a permanent audit trail.

Built with **Next.js 16, React 19, TypeScript, Tailwind CSS**, and **PostgreSQL 18**. It runs entirely on a local machine — no Docker, cloud account, or paid service required to try it.

**Status:** 🚧 WIP · core inventory, households/pickups, forecasting, messaging, assistant, and reporting are implemented and pass typecheck/lint/build; end-to-end polish, deployment, and live provider integrations are ongoing.

---

## What it does

Most inventory apps store a single "quantity on hand" number and edit it in place. That loses history and makes mistakes impossible to trace. This app is built the opposite way: **every physical change is a permanent, append-only ledger entry**, and every displayed number (on hand, reserved, available, expiring) is calculated from that ledger. Nothing is ever silently overwritten.

On top of that foundation it provides a complete pantry workflow:

- **Accounts & organizations** — sign up, create an organization, add pantry locations, invite teammates, and assign roles (administrator, manager, inventory worker, volunteer, read-only). Everything a user can see or do is controlled by fine-grained permissions.
- **Inventory** — item catalog with units and conversions, lot-level tracking with expiration dates, receiving from donors and purchases, manual adjustments, reversals/corrections, spoilage & damage, quarantine, recalls, cycle counts, reconciliation, and transfers between locations. Balances always come from the immutable ledger.
- **Households & pickups** — household records (with privacy-tiered contact and sensitive notes), dietary/allergen preferences, SMS-consent records, duplicate detection, package templates with household-size rules, appointment scheduling, check-in, and pickup fulfillment.
- **Reservations** — reserving food for an appointment **lowers what's available but never touches physical stock**. Inventory is only consumed (as a ledger entry) when a pickup is actually completed. Cancellations and no-shows automatically release the hold.
- **Forecasting** — deterministic, explainable item/category demand and expiration forecasts plus donation-need suggestions. (No black-box guessing — you can always see the math.)
- **Messaging** — consent-aware SMS workflows with templates, campaigns, and delivery history. Runs in **simulation mode by default** (nothing is actually sent) and only talks to Twilio if you add credentials.
- **AI assistant** — an optional, permission-scoped helper limited to a fixed set of read tools and confirmation-gated suggestions. It cannot run arbitrary queries, move stock, or send messages on its own.
- **Reports** — operational summaries and CSV exports (with spreadsheet-formula injection neutralized), all permission-checked and audited.

### The core idea, in one line

> Physical stock, reserved stock, expected demand, and forecasts are four different things — this app keeps them separate, auditable, and impossible to accidentally conflate.

---

## Tech at a glance

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| Database | PostgreSQL 18 (native, local) |
| Data access | Drizzle ORM + version-controlled SQL migrations (server-only) |
| Auth | Better Auth with database-backed sessions |
| Testing | Vitest (unit/integration) + Playwright (end-to-end) |
| Optional providers | Twilio (SMS) and OpenAI (assistant) — both off by default |

Security is enforced in layers: the database is accessed only from trusted server code as a non-superuser role, every write authorizes independently, and the ledger and audit history are immutable. There is no direct database access from the browser.

---

## Getting started

### 1. Prerequisites

- **Node.js 20+** (developed on Node 24)
- **pnpm** (`npm install -g pnpm`, or use it via `corepack`)
- **PostgreSQL 18** running locally on port 5432

### 2. Install

```bash
git clone https://github.com/HeroicSwan/food-pantry-inventory-sms-assistant.git
cd food-pantry-inventory-sms-assistant
pnpm install
```

### 3. Create the databases

Create two databases and an application role in your local PostgreSQL:

```sql
CREATE ROLE pantry_app LOGIN PASSWORD 'choose-a-local-password';
CREATE DATABASE food_pantry_dev OWNER pantry_app;
CREATE DATABASE food_pantry_test OWNER pantry_app;
```

### 4. Configure environment

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

At minimum set these in `.env.local` (Twilio/OpenAI can stay blank):

```ini
DATABASE_URL="postgresql://pantry_app:choose-a-local-password@localhost:5432/food_pantry_dev"
TEST_DATABASE_URL="postgresql://pantry_app:choose-a-local-password@localhost:5432/food_pantry_test"
BETTER_AUTH_SECRET="a-random-string-of-at-least-32-characters"
BETTER_AUTH_URL="http://localhost:3000"
APP_URL="http://localhost:3000"
SEED_USER_PASSWORD="a-strong-local-demo-password"
```

> On Windows with PostgreSQL 18 installed, `scripts/setup-native-postgres.ps1` can create the role, databases, and `.env.local` automatically. It reads admin/app passwords from an ignored `.env.setup.local` file.

### 5. Migrate, seed, and run

```bash
pnpm db:migrate   # apply all SQL migrations to a clean database
pnpm db:seed      # load fictional demo data
pnpm dev          # start the app
```

Open **http://localhost:3000**.

### 6. Log in with a demo account

The seed creates a fictional organization, **Harbor Community Food Pantry**, with one account per role. Sign in with any of these emails using the `SEED_USER_PASSWORD` you set above:

| Email | Role |
|---|---|
| `admin@harbor-pantry.example.test` | Administrator (full access) |
| `manager@harbor-pantry.example.test` | Pantry manager |
| `worker@harbor-pantry.example.test` | Inventory worker |
| `volunteer@harbor-pantry.example.test` | Volunteer (limited) |
| `viewer@harbor-pantry.example.test` | Read-only |

There's also `suspended@harbor-pantry.example.test` (shows the blocked-access state) and `admin@other-pantry.example.test` (a separate organization, used to demonstrate that data never crosses organizations).

All demo emails use the reserved `example.test` domain and fictional phone numbers. **No real people, phone numbers, or messages are involved.**

---

## Everyday commands

```bash
pnpm dev          # run the development server
pnpm build        # production build
pnpm lint         # ESLint (zero warnings allowed)
pnpm typecheck    # strict TypeScript check
pnpm db:migrate   # apply migrations
pnpm db:seed      # reload demo data
```

Testing:

```bash
pnpm test              # unit tests (no database needed)
pnpm test:db           # database + integration tests (uses food_pantry_test)
pnpm test:e2e          # full end-to-end browser tests (Playwright)
```

`test:db` and `test:e2e` reset, migrate, and seed the isolated `food_pantry_test` database — they never touch your development data.

---

## Optional integrations

The app is fully usable with these turned off.

- **SMS (Twilio):** Leave the `TWILIO_*` variables blank to stay in simulation mode — messages are recorded but never sent. Add real credentials plus a publicly reachable webhook URL to enable live delivery. Every message is re-checked against consent history first.
- **AI assistant (OpenAI):** Leave `OPENAI_API_KEY` blank to keep the assistant disabled. When enabled, it can only use a fixed set of read tools and can only *propose* actions that an authorized user must confirm.
- **Scheduled jobs:** Forecast and messaging workers can be run on a schedule; the protected job routes require a `CRON_SECRET`.

---

## Project layout

```
src/
  app/            Next.js routes (auth, dashboard, inventory, pickups, forecast, messages, reports)
  domains/        Business logic per area (inventory, pickups, forecasting, messaging, assistant, reports, admin, auth)
  lib/            Database client, auth, permissions, validation, error mapping
drizzle/          Version-controlled SQL migrations (0000 → 0007)
scripts/          Database migrate/seed/setup helpers
docs/             Architecture and per-phase implementation notes (01 → 26)
tests/            Vitest (unit/integration) and Playwright (e2e) suites
```

The `docs/` folder is the deeper reference — architecture decisions, the inventory-ledger model, security & privacy, and a per-phase implementation write-up for each major system.

---

## Notes & limitations

- This is a portfolio/demonstration project. It runs and is verified against a **local, native PostgreSQL** setup. A real deployment additionally needs a managed database, real secrets, backups, and (if used) live Twilio/OpenAI credentials with public callback URLs.
- Authorization is enforced in trusted server code and the database schema (constraints, triggers, and a non-superuser role) rather than Postgres row-level security.
- No real personal data, phone numbers, or messages are used anywhere — all demo data is fictional.

## License

No license is currently specified. All rights reserved by the author unless a license file is added.
