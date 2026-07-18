# Implementation roadmap

## Prompts 2–7: implemented locally

The application now includes native Windows PostgreSQL infrastructure, Better Auth, organizations and scoped permissions, immutable inventory operations, households and pickups, deterministic forecasting and alerts, consent-aware simulation messaging, a controlled assistant, and operational reports/exports.

The final local validation workflow is:

```powershell
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:jobs
pnpm test:sms
pnpm test:ai
pnpm test:reports
pnpm test:accessibility
pnpm test:e2e
pnpm build
```

## Deployment-stage work

Live Twilio delivery, public webhook verification, Ollama model validation, Vercel/Windows scheduler registration, production credentials, backup/restore rehearsal, and external accessibility/performance audits require target-environment configuration. They are documented, not silently treated as complete.

All future changes must preserve server-only database access, atomic PostgreSQL transactions, organization/location scope, immutable ledger and audit records, consent enforcement, controlled assistant confirmation, and test-database isolation.
