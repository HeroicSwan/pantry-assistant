# Pantry Assistant 0.1.0-rc.1 release readiness

This release candidate targets a self-hosted Windows food pantry using native PostgreSQL and a local network. It does not require Docker, WSL, virtualization, Supabase, or paid hosting.

## Safe defaults

- SMS connectors are installed and selectable, but a new production installation does not seed a pantry or user account. Messaging starts disabled/safe simulation until a pantry administrator supplies provider credentials, sender configuration, consent records, and webhook settings.
- Autonomous purchasing, disposal, transfers, and inventory changes are disabled by database policy.
- Autonomous AI writes are disabled by environment default and require an explicit administrator policy plus a worker process.
- The assistant uses the local deterministic provider unless a local Ollama provider is explicitly selected.

## Email delivery

Password-reset and invitation flows use SMTP when `SMTP_HOST` and `SMTP_FROM` are configured. `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_SECURE` control the connection. Without SMTP, links are written to the local development message inbox so a new installation remains testable without an external provider. Live delivery requires the foodbank's own mail provider credentials and domain policy.

## Backups

Use `pnpm selfhost:backup` to create a PostgreSQL custom-format dump. Restore rehearsals must target a separate local database; never overwrite a live database during a test. The release validation restored the current archive into a temporary database and verified 96 public tables before dropping that temporary database.

## LAN HTTPS/TLS

The application can bind to the LAN with `pnpm start:lan`, but HTTPS requires a certificate and private key trusted by the foodbank's devices. Configure TLS at an approved Windows reverse proxy (IIS or Caddy) and set `APP_URL` and `BETTER_AUTH_URL` to the resulting `https://` origin. A certificate cannot be safely selected or trusted from this development workstation without the target LAN and administrator approval.

## Release gates still requiring deployment access

1. Install the package on a clean Windows PC and run the packaged browser E2E suite. The repository E2E suite now uses its own port (3101) and never reuses a process on port 3000.
2. Install and trust the LAN certificate/reverse proxy.
3. Configure and test the foodbank SMTP provider.
4. Optionally configure one SMS provider and send a consented test message.
5. Complete the privacy/security review before entering real household data.

The repository-level checks, database migration/seed workflow, backup/restore rehearsal, secret scan, and package build are automated and recorded in `docs/26-final-test-report.md`.
