# Pantry Assistant

![status](https://img.shields.io/badge/status-v0.1.0--rc.1-blue)
![tests](https://img.shields.io/badge/tests-176%20passing-brightgreen)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)

**A full-stack app that helps a food pantry (or a small network of them) run daily operations** — track real inventory, schedule household pickups, reserve food, forecast needs, and communicate with families, all with strict privacy and a permanent audit trail.

> **Production self-hosted release candidate.** Extract the Windows package and run the installer from an elevated PowerShell window. Configure approved SMTP/SMS credentials and LAN TLS before entering real household data.

---

## Contents

- [What it does](#what-it-does)
- [The big idea](#the-big-idea)
- [Tech stack](#tech-stack)
- [Security & data protection](#security--data-protection)
- [Quick start](#quick-start)
- [Installation](#installation)
- [Commands](#commands)
- [Tests](#tests)
- [Optional integrations](#optional-integrations)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [License](#license)

---

## What it does

| Area | What you can do |
|---|---|
| 👤 **Accounts & teams** | Sign up, create an organization, add pantry locations, invite teammates, and assign roles (admin, manager, inventory worker, volunteer, read-only). Every action is permission-gated. |
| 📦 **Inventory** | Item catalog with units & conversions, lot-level tracking with expiration dates, receiving from donors & purchases, adjustments, reversals/corrections, spoilage & damage, quarantine, recalls, cycle counts, reconciliation, and transfers between locations. |
| 🏠 **Households & pickups** | Household records with privacy-tiered contact info, dietary/allergen flags, SMS-consent records, duplicate detection, package templates with household-size rules, appointments, and check-in. |
| 🧮 **Reservations** | Reserving food for an appointment **lowers availability without touching physical stock**. Stock is only consumed when a pickup is completed. Cancellations and no-shows auto-release the hold. |
| 📈 **Forecasting** | Deterministic, explainable demand and expiration forecasts plus donation-need suggestions — you can always see the math. |
| 💬 **Messaging** | Consent-aware SMS workflows with templates, campaigns, and history. **Simulation mode by default** (nothing is sent); talks to Twilio only if you add credentials. |
| 🤖 **AI assistant** | Optional, permission-scoped helper limited to a fixed set of read tools and confirmation-gated suggestions. It cannot run arbitrary queries, move stock, or send messages on its own. |
| 📊 **Reports** | Operational summaries and CSV exports (spreadsheet-formula injection neutralized), all permission-checked and audited. |

## The big idea

Most inventory apps store one editable "quantity on hand" number. That loses history and makes mistakes impossible to trace. Pantry Assistant does the opposite:

> **Every physical change is a permanent, append-only ledger entry.** Every number you see — on hand, reserved, available, expiring — is *calculated* from that ledger. Nothing is ever silently overwritten.

Physical stock, reserved stock, expected demand, and forecasts are four different things, and the app keeps them separate, auditable, and impossible to accidentally conflate.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS |
| Database | PostgreSQL 18 (native/local — no Docker needed) |
| Data access | Drizzle ORM + version-controlled SQL migrations, **server-only** |
| Auth | Better Auth with database-backed sessions |
| Testing | Vitest (unit + integration) + Playwright (end-to-end) |
| Optional providers | Twilio-compatible SMS connectors and local Ollama assistant |

---

## Security & data protection

Pantry Assistant handles credentials and sensitive household information, so it's built defensively. Here is **exactly** how data is protected — and, just as importantly, what is *not* yet protected.

### How each thing is secured

| What | How it's protected |
|---|---|
| **Passwords** | Hashed with **scrypt** (a slow, memory-hard algorithm) by Better Auth. Only the hash is stored — the original password is never saved and can't be recovered, even from a full database dump. |
| **Login sessions** | After sign-in the browser holds only an **opaque, HTTP-only session cookie** signed with a server-only secret (`BETTER_AUTH_SECRET`, min 32 chars). The real session lives in the database and is re-validated on the server for every protected request. Sign-out and password reset revoke sessions. |
| **Invitation links** | A random **256-bit token** goes into the invite link, but the database stores only its **SHA-256 hash**. A leaked database can't be turned back into working invites, and tokens expire (7 days). |
| **Password reset** | Handled by Better Auth's short-lived verification tokens; reset also revokes existing sessions. |
| **Inbound SMS webhooks** | Twilio callbacks are authenticated with an **HMAC-SHA1 signature** derived from the request and your Twilio auth token, compared in **constant time** (`timingSafeEqual`) to defeat timing attacks. Forged or tampered calls are rejected with `403`. |
| **Scheduled-job endpoints** | Require a `CRON_SECRET` bearer token. |
| **Secrets** (DB URL, auth secret, API keys) | Read from environment variables, **validated at startup**, and used only in server-only modules (`import "server-only"`). There are no `NEXT_PUBLIC_` secrets, the browser never receives a database connection or any key, and `.env*` files are git-ignored. |
| **Data in transit** | Encrypted with **TLS/HTTPS** in any real deployment (local development uses `http://localhost`). |
| **Database access** | The app connects as a **non-superuser** PostgreSQL role from trusted server code only. Organization/location isolation, immutable ledger/audit history, and negative-stock protection are enforced by database constraints and triggers — not just in application code. |
| **Sensitive records** | Household data is split into **tiers** (basic / contact / sensitive notes). Each tier requires a specific permission checked on both the server and the database. Volunteers never receive contact tables or sensitive notes. |

### What is and isn't encrypted (honest summary)

- ✅ **Passwords** are one-way hashed (scrypt) — not reversible.
- ✅ **Invitation tokens** are one-way hashed (SHA-256) before storage.
- ✅ **Session cookies** are signed with a server secret; **webhooks** are HMAC-verified.
- ✅ **Traffic** is encrypted via TLS in deployment.
- ⚠️ **Individual database fields are *not* application-level encrypted.** Columns like phone numbers and sensitive household notes are stored as plaintext in PostgreSQL, protected by permission-based access control and whatever encryption-at-rest the database host provides — **not** by per-field encryption in the app.

> **Planned:** column-level encryption for the most sensitive fields (e.g., sensitive notes) is noted as future work. Until then, treat this as a demo and keep real personal data out of it.

More detail lives in [`docs/09-security-and-privacy.md`](docs/09-security-and-privacy.md), [`docs/10-testing-strategy.md`](docs/10-testing-strategy.md), and [`docs/25-final-security-review.md`](docs/25-final-security-review.md).

---

## Installation

### Foodbank installation

For a downloadable Windows installation, extract the release folder and run `pnpm selfhost:setup` from an elevated PowerShell window. Setup creates the local databases, applies migrations, builds the production app, registers automatic startup, and can enable LAN access through the Windows Private-profile firewall. It does not load fictional users or data unless `-SeedDemoData` is explicitly supplied. See [`docs/27-self-hosted-windows-installation.md`](docs/27-self-hosted-windows-installation.md).

**Prerequisites:** Node.js 20+ · pnpm (`npm install -g pnpm`) · PostgreSQL 18 on port 5432.

```bash
# 1. Clone & install
git clone https://github.com/HeroicSwan/pantry-assistant.git
cd pantry-assistant
pnpm install
```

```sql
-- 2. Create a role and two databases in your local PostgreSQL
CREATE ROLE pantry_app LOGIN PASSWORD 'choose-a-local-password';
CREATE DATABASE food_pantry_dev  OWNER pantry_app;
CREATE DATABASE food_pantry_test OWNER pantry_app;
```

```bash
# 3. Configure the environment
cp .env.example .env.local
```

Set at least these in `.env.local` (SMS credentials are optional):

```ini
DATABASE_URL="postgresql://pantry_app:choose-a-local-password@localhost:5432/food_pantry_dev"
TEST_DATABASE_URL="postgresql://pantry_app:choose-a-local-password@localhost:5432/food_pantry_test"
BETTER_AUTH_SECRET="a-random-string-of-at-least-32-characters"
BETTER_AUTH_URL="http://localhost:3000"
APP_URL="http://localhost:3000"
SEED_USER_PASSWORD="a-strong-local-demo-password"
```

```bash
# 4. Migrate and run
pnpm db:migrate   # apply all SQL migrations to a clean database
pnpm dev          # start the app on http://localhost:3000
```

> 💡 On Windows with PostgreSQL 18 installed, `scripts/setup-native-postgres.ps1` can create the role, databases, and `.env.local` for you (it reads admin/app passwords from an ignored `.env.setup.local`).

## Development-only seed data

The seed builds a fictional organization — **Harbor Community Food Pantry** — with one account per role. Sign in with any email below using the `SEED_USER_PASSWORD` you chose:

| Email | Role |
|---|---|
| `admin@harbor-pantry.example.test` | Administrator (full access) |
| `manager@harbor-pantry.example.test` | Pantry manager |
| `worker@harbor-pantry.example.test` | Inventory worker |
| `volunteer@harbor-pantry.example.test` | Volunteer (limited) |
| `viewer@harbor-pantry.example.test` | Read-only |

Also included: `suspended@harbor-pantry.example.test` (shows the blocked-access state) and `admin@other-pantry.example.test` (a separate organization, to demonstrate that data never crosses organizations). All demo emails use the reserved `example.test` domain and fictional phone numbers — **no real people or messages are involved.**

---

## Commands

```bash
pnpm dev          # development server
pnpm build        # production build
pnpm lint         # ESLint (zero warnings allowed)
pnpm typecheck    # strict TypeScript check
pnpm db:migrate   # apply migrations
pnpm db:seed      # development-only fictional data; never use for production
```

## Tests

**176 automated tests, all passing** on the current build:

| Suite | Tests | Covers | Command |
|---|---:|---|---|
| Unit | **98** | Ledger math, FEFO allocation, unit conversion, permission & state-machine rules, forecasting, error mapping, AI assistant policy/provider, env-schema validation, SMS providers | `pnpm test` |
| Database + integration | **48** | Org/location isolation, immutable ledger, negative-stock protection, reservations, pickup fulfillment, concurrency, AI assistant proposal lifecycle & permission scoping | `pnpm test:db` |
| End-to-end | **30** | Full browser flows (desktop + mobile) — sign-in, role limits, inventory, pickups, reports, accessibility | `pnpm test:e2e` |
| **Total** | **176** | | |

`test:db` and `test:e2e` reset, migrate, and seed the isolated `food_pantry_test` database — they never touch your development data. `pnpm typecheck`, `pnpm lint`, and `pnpm build` also pass.

---

## Optional integrations

The app is fully usable with all of these turned off.

- **SMS providers** — leave credentials blank and use `Disabled` or `Simulation` mode for local use. Each pantry location can select Twilio, Vonage, Plivo, Telnyx, Sinch, Infobip, Bandwidth, Bird, Amazon SNS, or Azure Communication Services from Messaging settings. Live delivery requires that provider's server-only credentials and sender configuration; every message is re-checked against consent history first.
- **AI assistant (local Ollama)** — set `ASSISTANT_PROVIDER=ollama` and point it at a locally hosted [Ollama](https://ollama.com) server (default `qwen2.5:7b`); no data ever leaves the machine, and no external AI provider is involved. Defaults to a keyword-based router with no model at all. Either way, it can only use fixed read tools and can only *propose* actions an authorized user must confirm.
- **Scheduled jobs** — forecast and messaging workers can run on a schedule; the job routes require a `CRON_SECRET`.
- **Advanced capabilities** — opt-in seasonal/causal forecasting, autonomous operations, PostgreSQL-backed job queues, custom report layouts, server-generated PDFs, scoped attachments, eligibility records, country compliance profiles, and controlled autonomous AI writes are documented in [`docs/28-advanced-capabilities.md`](docs/28-advanced-capabilities.md).

## Project layout

```
src/
  app/        Next.js routes (auth, dashboard, inventory, pickups, forecast, messages, reports)
  domains/    Business logic per area (inventory, pickups, forecasting, messaging, assistant, reports, admin, auth)
  lib/        Database client, auth, permissions, validation, error mapping
drizzle/      Version-controlled SQL migrations (0000 → 0009)
scripts/      Database migrate / seed / setup helpers
docs/         Architecture and per-phase implementation notes (01 → 26)
tests/        Vitest (unit/integration) and Playwright (e2e) suites
```

## Limitations

- Self-hosted Windows product. A real deployment additionally needs approved secrets, backups, LAN HTTPS/TLS, and any live SMS credentials the foodbank chooses to enable.
- Authorization is enforced in trusted server code and the database schema (constraints, triggers, a non-superuser role) rather than Postgres row-level security.
- No per-field encryption yet (see [Security & data protection](#security--data-protection)).
- All demo data is fictional — no real personal data, phone numbers, or messages anywhere.

## License

Pantry Assistant is licensed under the [MIT License](LICENSE).
