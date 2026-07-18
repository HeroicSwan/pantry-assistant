# Production deployment

The primary product target is a self-hosted Windows installation, not a hosted SaaS deployment. Follow [`docs/27-self-hosted-windows-installation.md`](27-self-hosted-windows-installation.md) for the packaged foodbank workflow.

The verified development environment is Next.js plus native PostgreSQL 18 on Windows. Docker, Supabase, and virtualization are not required.

For production, provision PostgreSQL with backups and TLS, create a non-superuser application role, set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `APP_URL`, then run `pnpm db:migrate` before starting the built application. Never run the fictional seed in production.

`/health` checks the process and `/ready` verifies database access and reports the migration count without exposing credentials. Forecast and messaging cron routes are protected by `CRON_SECRET`; configure the target scheduler to call `/api/jobs/forecast` and `/api/jobs/messaging` with `Authorization: Bearer <secret>`. Monitor failed forecast jobs, SMS failures, webhook failures, assistant provider errors, authentication denials, and database latency.

For local Windows development, the job workers do not need Docker or a provider connection. Run them once with `pnpm forecast:run-jobs` and `pnpm messaging:run-jobs`, or register current-user Task Scheduler jobs with `powershell -ExecutionPolicy Bypass -File scripts/register-local-jobs.ps1`. The helper schedules both jobs every five minutes; remove them with `-Action Remove`.

Live SMS requires the selected provider's server-only credentials, sender configuration, and provider-specific delivery/inbound webhook configuration where supported. The provider registry currently includes Twilio, Vonage, Plivo, Telnyx, Sinch, Infobip, Bandwidth, Bird, Amazon SNS, and Azure Communication Services. Keep simulation mode until the selected provider is verified end to end with test credentials and a real consented test recipient.

Password-reset and invitation emails use the optional SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_SECURE`). When SMTP is not configured, links are retained in the local development message inbox rather than silently discarded. Do not put SMTP credentials in tracked files or expose them through `NEXT_PUBLIC_*` variables.

For LAN use, terminate HTTPS at an approved Windows reverse proxy such as IIS or Caddy, install a certificate trusted by the foodbank's devices, and set both `APP_URL` and `BETTER_AUTH_URL` to the HTTPS origin. The application cannot create a trusted certificate without access to the target LAN and its administrator approval.

The assistant is Ollama-only. Install the approved local Ollama model, set `ASSISTANT_PROVIDER=ollama`, and keep `OLLAMA_ASSISTANT_BASE_URL` on the local machine. The controlled tool registry remains the database boundary; never give the model database credentials.

Back up PostgreSQL before migrations, retain point-in-time recovery where available, and test restore procedures. Rollback is application-version rollback plus a forward corrective migration—do not destructively rewrite applied migrations or immutable ledger history.
