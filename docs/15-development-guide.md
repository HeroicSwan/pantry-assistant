# Development guide

## Inventory operations workflow

After changing inventory schema, generate and inspect a version-controlled migration, then prove it against a clean test database before applying the development migration. Prompt 4 is migration `0004_inventory_operations.sql`.

Use `pnpm test:db` for native PostgreSQL integration validation and `pnpm test:e2e` for the production-build desktop/mobile suite. Both destructive workflows are guarded to `food_pantry_test`; do not point `TEST_DATABASE_URL` at the development database.

Operational source is in `src/domains/inventory/operations-service.ts`, `operations-actions.ts`, `operations-queries.ts`, and `operations-policy.ts`. All PostgreSQL imports must remain server-only. New writes must resolve authorization inside the transaction, use server-derived conversions, append ledger/audit records, and carry an idempotency key where retries are possible.

## Requirements and local services

For foodbank distribution, use the self-hosted Windows workflow in [`docs/27-self-hosted-windows-installation.md`](27-self-hosted-windows-installation.md). It runs the built Pantry Assistant app on the foodbank PC and can allow private-LAN access without exposing PostgreSQL.

Use Node.js 24+, pnpm, Git, and native PostgreSQL 18. PostgreSQL is installed at `C:\Program Files\PostgreSQL\18`, listens locally on port 5432, and starts automatically through `postgresql-x64-18`. No container engine or virtualization layer is used.

The setup script is idempotent:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-native-postgres.ps1
```

It reads administrator and application secrets only from ignored `.env.setup.local`, creates or reuses the non-superuser `pantry_app` role and both project databases, writes ignored `.env.local`, and verifies real SQL logins. `.env.example` contains placeholders only.

## Everyday workflow

```powershell
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Database commands:

- `pnpm db:generate` creates a reviewed migration from schema changes.
- `pnpm db:migrate` applies unapplied development migrations.
- `pnpm db:status` reports migration and table counts.
- `pnpm db:seed` idempotently seeds fictional development data.
- `pnpm db:test:reset` clears only the guarded test database.
- `pnpm db:test:migrate` and `pnpm db:test:seed` prepare tests.

Never use schema synchronization as a substitute for migrations. Review generated SQL, add deliberate constraints/triggers, then prove it from a clean test database.

## Service and health commands

Run `pnpm appointments:run-jobs` to generate recurring pickup occurrences and `pnpm ai:retention` to archive stale assistant conversations. Both workers are bounded, local, and safe to run repeatedly.

```powershell
Get-Service postgresql-x64-18
Start-Service postgresql-x64-18
Restart-Service postgresql-x64-18
& "C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -h localhost -p 5432
pnpm db:status
```

`GET /health` returns a minimal application status without secrets. Database errors are logged server-side with request IDs and are not returned raw to browsers.

## Backups and migration recovery

Use `pg_dump.exe --format=custom` for a logical backup and `pg_restore.exe` into a separate recovery database. Never test restores over the development database. Before a risky migration, back up, apply to `food_pantry_test` from a clean schema, run integration/E2E checks, then apply to development. If a migration fails, preserve the error, inspect its transaction state and migration history, repair with a forward migration, and restore into a separate database only when a data recovery is actually required.

## Credentials

`DATABASE_URL`, `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, and `SEED_USER_PASSWORD` are server-only. They must never use a `NEXT_PUBLIC_` prefix, enter source control, appear in screenshots, or be printed in documentation. The application role is not a PostgreSQL administrator.
