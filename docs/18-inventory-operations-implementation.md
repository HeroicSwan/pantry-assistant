# Inventory operations implementation

## Delivered scope

Prompt 4 completes the operational inventory layer on top of the Prompt 3 ledger:

- Donor records and donation history.
- Anonymous donation intake.
- Multi-line donation, purchase, and other-source receiving.
- Normal and high-risk inventory adjustments.
- Correction chains using reversal plus replacement.
- Spoilage, damage, expiration removal, and recall disposal.
- Quarantine and recall holds.
- Cycle-count snapshots, approval, stale detection, and reconciliation.
- Transfer request, separate approval, dispatch, partial receipt, full receipt, discrepancy resolution, and in-transit balances.

Later phases add households, appointments, reservations, forecasting, alerts, consent-aware messaging, controlled assistant tools, and reporting without changing these inventory-ledger guarantees.

## Native architecture

The application remains Docker-free and Supabase-free:

- Next.js and pnpm run directly on Windows.
- PostgreSQL 18 runs as the `postgresql-x64-18` Windows service.
- Drizzle maps schema types and runs version-controlled SQL migrations.
- Better Auth resolves the server-side user and database-backed session.
- Server-only services resolve the acting membership and permission for every write.
- Composite foreign keys, checks, uniqueness rules, and triggers enforce the final database boundary.

Supabase RLS was not reintroduced. Its security purpose is provided by trusted server-only database access, mandatory organization/location arguments, permission checks inside transactional services, composite scope constraints, and integration tests that call services directly.

## Schema and migration

Migration `drizzle/0004_inventory_operations.sql` creates:

- `donors`
- `donations`
- `donation_lines`
- `purchased_shipments`
- `receiving_sessions`
- `receiving_lines`
- `adjustment_requests`
- `inventory_condition_events`
- `inventory_recalls`
- `inventory_recall_lots`
- `inventory_lot_holds`
- `cycle_count_sessions`
- `cycle_count_entries`
- `inventory_transfers`
- `inventory_transfer_lines`
- `inventory_transfer_receipts`

It also recreates the derived balance views with Prompt 4 semantics and adds `inventory_in_transit_balances`.

Important constraints include organization-scoped donor references, donation and transfer numbers, source-shape checks, positive normalized quantities, unique idempotency keys, distinct transfer locations, separate requester/approver checks, cumulative receipt limits, and composite location/lot ownership.

Database triggers provide:

- Automatic `updated_at` timestamps.
- Cross-organization and cross-location scope validation.
- Immutable condition events, recall-lot links, and transfer receipts.
- Immutable completed receiving lines.
- Release-only hold mutation.
- Receiving, adjustment, cycle-count, and transfer state transitions.
- Transfer-line immutability after dispatch except cumulative receipt quantity.
- Over-receipt prevention under row locks.

## Receiving workflow

1. Create a donor-backed or anonymous donation intake, purchased shipment, or other-source receipt.
2. Start a location-scoped receiving session with an idempotency key.
3. Add one or more draft lines using entered units and dates.
4. On completion, lock the session, validate every line, resolve item-specific conversion factors, create or reuse correctly scoped lots, and append receipt transactions.
5. Mark every line and the source complete in the same transaction.

A failed line rolls the entire completion back. Retrying a completed session does not duplicate ledger entries.

## Adjustments and corrections

The server computes risk from normalized base quantity and current physical balance. A normal request posts immediately for an actor with `inventory.adjust`. A high-risk request remains submitted until a different actor with `inventory.adjust_large` approves it. Requester identity, conversion factor, normalized quantity, decision, transaction, and audit event remain linked.

Corrections never edit history. The correction service appends an exact reversal and a replacement transaction with one correlation identifier in a single database transaction.

## Conditions, expiration, quarantine, and recalls

Spoilage, damage, expiration removal, and recall disposal are physical changes and append negative ledger entries. Expiration removal checks the location-local date. Quarantine and recall are status-only holds: physical on-hand does not change, while available stock becomes zero for the held lot.

Recall activation links affected lots, condition events, and active recall holds. Resolution records new events and releases holds. Disposal uses the `recall_disposal` ledger transaction type while the active recall remains traceable.

## Cycle counts

Starting a count captures each eligible lot and its physical balance at one snapshot time. Counted values are converted on the server and variances are derived, not trusted from the browser. Submission requires every entry. A separate approver is required for reconciliation.

Before posting variances, reconciliation checks for any location ledger activity after the snapshot. If stock changed, the session becomes `stale` and posts nothing. Otherwise each nonzero variance appends an adjustment transaction and the session becomes reconciled.

## Transfers

Transfers use separate source and destination events:

1. A source-authorized actor creates and requests the transfer.
2. A different actor approves it.
3. Dispatch appends `transfer_out` transactions and establishes in-transit quantities.
4. Each destination receipt creates or reuses a destination lot and appends `transfer_in`.
5. Partial receipts preserve the remaining in-transit balance.
6. Full receipt clears in-transit stock; an authorized actor can record discrepancy resolution when needed.

The database locks transfer and line rows and rejects cumulative receipts above dispatched quantity. Transfers cannot be cancelled after dispatch; they must be received or resolved so stock never disappears silently.

## Permissions

Prompt 4 adds permission keys for:

- Donor view/create/update/archive.
- Receiving view/create/complete/cancel/validation override.
- Adjustment correction and elevated approval.
- Spoilage, damage, expiration, quarantine release, recall, and recall resolution.
- Reconciliation approval.
- Transfer approval, dispatch, receipt, cancellation, and discrepancy resolution.

Administrators receive all permissions. Pantry managers receive the operational and approval permissions. Inventory workers receive bounded receiving, normal adjustment, removal, counting, dispatch, and receipt permissions at assigned locations. Volunteers and read-only users receive no Prompt 4 write permission.

## User interface

Permission-aware routes are under `/app/[organizationSlug]/inventory`:

- `/donors` and `/donors/[donorId]`
- `/receiving` and `/receiving/[sessionId]`
- `/adjustments`
- `/conditions`
- `/counts` and `/counts/[sessionId]`
- `/transfers` and `/transfers/[transferId]`

The inventory overview links these areas only when relevant view permissions are present. Server-side services independently recheck authorization; hidden controls are not a security boundary.

## Seed data

The idempotent development/test seed includes fictional donor records, a grocery-rescue donation, a draft receiving line, a high-risk adjustment awaiting approval, and an inter-location transfer draft. No real contact information is used.

## Validation coverage

Unit tests cover conversion, FEFO, ledger signs, operation risk, and state policies. Native PostgreSQL integration tests cover clean migrations, receipt idempotency, multi-line atomic completion, separate approval, holds, transfer partial receipts, cross-organization denial, append-only records, negative-stock concurrency, and audit records.

Playwright validates administrator receiving through completion on desktop and mobile and confirms volunteer denial, in addition to the Prompt 2 authentication/onboarding/role suite.

## Operational notes

Run normal development commands:

```powershell
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Run the isolated database suite with `pnpm test:db`. Run complete browser validation with `pnpm test:e2e`; it resets only `food_pantry_test`, migrates and seeds it, builds production assets, and starts the production server.
