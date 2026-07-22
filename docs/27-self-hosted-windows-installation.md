# Pantry Assistant self-hosted Windows installation

Pantry Assistant is distributed as a Windows-only, self-hosted application. A foodbank runs it on its own PC; the PC owns the PostgreSQL database and the application data. Docker, Supabase, virtualization, a hosted database, and paid services are not required.

## Install

1. Extract the Pantry Assistant release folder to a permanent location.
2. Open PowerShell as Administrator in the application folder.
3. Run the setup wizard:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-wizard.ps1
```

The wizard can bootstrap missing prerequisites through WinGet, optionally enable private-LAN access through Caddy HTTPS, leave fictional training data off by default, and passes the PostgreSQL administrator password directly to setup as a Windows secure string. It never writes that administrator password to an environment file, command line, log, or package.

For non-interactive or scripted setup, run:

```powershell
pnpm selfhost:setup
```

On a clean Windows PC, Pantry Assistant can bootstrap Node.js LTS, pnpm, and the official PostgreSQL 18 installer through WinGet before setup continues:

```powershell
pnpm selfhost:setup -- -BootstrapPrerequisites
```

The PostgreSQL installer still requires the local administrator to choose and retain its PostgreSQL administrator password. Pantry Assistant then asks for that password only to create the restricted application role and databases; it never stores the PostgreSQL administrator password.

Setup asks only for the local PostgreSQL administrator password. It creates or reuses the non-superuser `pantry_app` role, creates `food_pantry_dev` and `food_pantry_test`, writes ignored local secrets, applies migrations, builds the production app, registers the `PantryAssistantApp` logon task, and registers the daily `PantryAssistantBackup` task. It does not seed fictional accounts by default.

Pantry Assistant binds the application itself to `127.0.0.1`. Secure LAN access is opt-in: the setup wizard installs Caddy, binds only HTTPS port 443 on the Private firewall profile, and gives the application an `https://` URL. Trust Caddy's local CA certificate on each approved LAN device before opening that URL. Plain HTTP is not supported for LAN access.

For a training workstation only, add `-SeedDemoData` to load the reserved fictional accounts and records. Never use that switch for a foodbank's production database.

Ollama is the only model provider. Use `pnpm selfhost:setup -- --AssistantProvider ollama` to enable it during setup, or use `disabled` to turn the assistant off. If Ollama is stopped, the app uses its internal deterministic safety fallback for approved read queries.

The application starts at `http://localhost:3000`. When LAN access is enabled, other computers on the same private network use `http://<foodbank-pc-name>:3000`. Do not expose the port directly to the public internet.

## Optional integrations

- SMS is controlled per organization/location from Messaging settings. `Disabled` and `Safe simulation` never contact a provider. `Live provider` requires server-only credentials, a sender, consent records, and provider webhook configuration.
- The assistant provider is controlled by `ASSISTANT_PROVIDER`: `disabled` or `ollama`. Ollama is local-only and may be stopped without affecting core operations.
- Email delivery is disabled until an approved email provider is configured. Password reset and invitation records remain server-side; no provider credential is required for local use.

## Start, stop, and update

The registered Windows logon task starts the production Next.js server without opening a terminal window. The server writes to `data/logs/pantry-assistant.log`.

```powershell
Unregister-ScheduledTask -TaskName PantryAssistantApp -Confirm:$false
pnpm selfhost:setup
```

Use the local updater with an official Pantry Assistant ZIP package. It first creates an encrypted backup, validates the replacement application files by installing dependencies and building before migrations run, and stores the previous application files in `data\update-rollbacks`.

```powershell
pnpm selfhost:update -- -PackagePath C:\Downloads\PantryAssistant-windows-YYYYMMDD-HHMMSS.zip
```

If file validation fails, the updater restores the prior application files automatically before any database migration. The `-Rollback` option restores the most recent application-file snapshot (`pnpm selfhost:update -- -Rollback`). It never reverses database migrations automatically: after a migration has been applied, use a forward corrective migration or restore the encrypted backup into a separate recovery database first.

## Backups and restore

Create a logical PostgreSQL backup before upgrades:

```powershell
pnpm selfhost:backup
```

Restore only after stopping the application and confirming the destructive prompt:

```powershell
pnpm selfhost:restore --BackupFile .\backups\pantry-assistant-YYYYMMDD-HHMMSS.dump
```

Backups contain household and operational data. Store them encrypted and restrict access to trusted administrators.

The scheduled backup task runs daily at 2:00 AM and uses Windows EFS encryption for the account that installed Pantry Assistant. Keep backups on an NTFS drive, restrict folder access, and export the Windows EFS recovery certificate before moving encrypted backups to another computer. The backup command fails rather than reporting success if EFS encryption is unavailable, so choose an EFS-capable NTFS volume before relying on scheduled backups. The in-app **Organization → Health and recovery** page warns when a current backup is missing or overdue.

## Security boundary

The database remains server-only. LAN users authenticate through the application; they never receive PostgreSQL credentials. The Private Windows firewall profile is used for LAN access. Public exposure requires a separately reviewed reverse proxy with HTTPS, security headers, and network restrictions.
