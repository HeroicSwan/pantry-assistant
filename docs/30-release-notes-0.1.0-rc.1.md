# Pantry Assistant 0.1.0-rc.1 release notes

## Who this release is for

Windows food pantries that want to run their own local Pantry Assistant installation with native PostgreSQL, without Docker, virtualization, or paid hosting.

## What changed

- Added a Today at a glance dashboard with pickups, stock risks, expiring lots, unresolved alerts, and inbound-message work.
- Added common-task shortcuts, catalog filters saved per device, barcode/camera lookup, printable Code 128 item labels, and a safe CSV catalog importer.
- Added bulk acknowledgement for open operational alerts. Each changed alert receives its own event and the batch receives an audit entry.
- Added role-aware Help, printable volunteer quick-start and administrator handbook, plus optional larger text and comfortable screen spacing.
- Added Health and recovery, a non-sensitive support bundle, scheduled encrypted-backup support, a Windows installer wizard, and an application updater with rollback guidance.
- Isolated browser tests on port 3101 so they never reuse an unrelated application listening on port 3000.

## Upgrade notes

1. Make a fresh encrypted backup before applying an update.
2. Use the packaged updater or follow the recovery steps in [the Windows installation guide](27-self-hosted-windows-installation.md).
3. Apply migrations with `pnpm db:migrate`; do not edit or delete applied migration files.
4. Verify Health and recovery after the update. If it reports an overdue backup, correct that before normal operations resume.

## Verification in this release

- `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed.
- `pnpm test` passed: 98 tests.
- `pnpm test:integration` passed after a clean test reset: 49 tests.
- `pnpm test:e2e` passed against an isolated application server and clean test database: 30 desktop/mobile tests, including automated WCAG A/AA checks.
- `pnpm test:performance` verifies a 2,500-item organization/location-scoped inventory list on the isolated test database and removes its temporary data after the measurement.

## Still required at a real pantry site

- A clean install and backup/restore rehearsal on a separate Windows PC.
- LAN TLS certificate, firewall, and simultaneous-user verification on the target network.
- The pantry's SMTP and, if enabled, SMS provider credentials and consented live-message verification.
- A privacy/security review before entering real household data.
