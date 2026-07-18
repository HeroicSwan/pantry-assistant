# Pantry Assistant self-hosted Windows installation

Pantry Assistant is distributed as a Windows-only, self-hosted application. A foodbank runs it on its own PC; the PC owns the PostgreSQL database and the application data. Docker, Supabase, virtualization, a hosted database, and paid services are not required.

## Install

1. Extract the Pantry Assistant release folder to a permanent location.
2. Install Node.js 20 or newer, pnpm, and native PostgreSQL 18 as a Windows service.
3. Open PowerShell as Administrator in the application folder.
4. Run:

```powershell
pnpm selfhost:setup
```

Setup asks only for the local PostgreSQL administrator password. It creates or reuses the non-superuser `pantry_app` role, creates `food_pantry_dev` and `food_pantry_test`, writes ignored local secrets, applies migrations, builds the production app, registers the `PantryAssistantApp` logon task, and creates a Private-profile firewall rule for port 3000. It does not seed fictional accounts by default.

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

Run setup again after downloading an update. It reapplies migrations and rebuilds the application without replacing local secrets or development data.

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

## Security boundary

The database remains server-only. LAN users authenticate through the application; they never receive PostgreSQL credentials. The Private Windows firewall profile is used for LAN access. Public exposure requires a separately reviewed reverse proxy with HTTPS, security headers, and network restrictions.
