# Inventory foundation implementation

## Scope

Prompt 3 introduced the inventory catalog and immutable stock foundation without changing the Prompt 2 authentication, organization, membership, role, or audit systems. It runs on the same native Windows PostgreSQL service and server-only Drizzle connection.

Implemented foundation:

- Organization-scoped units, categories, items, and item-specific conversions.
- Safe catalog CSV import for spreadsheet migrations. It validates the whole file before writing, creates only missing categories and units, never overwrites an existing item, and appends an audit event.
- Location-scoped storage locations and lots.
- Append-only `inventory_transactions` with exact compensating reversals.
- Lot row locking, transaction sign rules, archived-lot denial, and negative-stock prevention.
- Derived lot and item/location balances with location-timezone expiration semantics.
- FEFO ordering and complete activity history.

Migrations `0002_inventory_ledger.sql` and `0003_inventory_ledger_rules.sql` contain the schema, views, functions, and triggers. Application code lives in `src/domains/inventory` and is server-only where it accesses PostgreSQL.

Prompt 4 extends this foundation. It does not replace, synchronize, or mutate ledger history. Receiving, adjustments, removals, reconciliation, and transfers all append transactions through the existing ledger service.
