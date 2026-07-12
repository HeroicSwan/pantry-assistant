# Production deployment

The verified development environment is Next.js plus native PostgreSQL 18 on Windows. Docker, Supabase, and virtualization are not required.

For production, provision PostgreSQL with backups and TLS, create a non-superuser application role, set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `APP_URL`, then run `pnpm db:migrate` before starting the built application. Never run the fictional seed in production.

`/health` checks the process and `/ready` verifies database access and reports the migration count without exposing credentials. Forecast and messaging cron routes are protected by `CRON_SECRET`; configure the target scheduler to call `/api/jobs/forecast` and `/api/jobs/messaging` with `Authorization: Bearer <secret>`. Monitor failed forecast jobs, SMS failures, webhook failures, assistant provider errors, authentication denials, and database latency.

For local Windows development, the job workers do not need Docker or a provider connection. Run them once with `pnpm forecast:run-jobs` and `pnpm messaging:run-jobs`, or register current-user Task Scheduler jobs with `powershell -ExecutionPolicy Bypass -File scripts/register-local-jobs.ps1`. The helper schedules both jobs every five minutes; remove them with `-Action Remove`.

Twilio live mode additionally requires server-only account/auth credentials, a sender or Messaging Service, and an exact public webhook base URL. Configure status and inbound callbacks to the implemented webhook routes. Keep simulation mode until signature validation is verified end to end.

OpenAI is optional. When enabled, set a server-only API key and approved model. The controlled tool registry remains the database boundary; never give a model database credentials.

Back up PostgreSQL before migrations, retain point-in-time recovery where available, and test restore procedures. Rollback is application-version rollback plus a forward corrective migration—do not destructively rewrite applied migrations or immutable ledger history.
