# Database design

## Inventory operations extension

Migration `0004_inventory_operations.sql` adds donor, donation, purchase, receiving, adjustment request, condition event, recall/hold, cycle-count, and transfer tables. Operational records reference Prompt 3 items, lots, units, and transactions through composite organization/location constraints.

`inventory_lot_balances` now derives physical, expired, valid, quarantined, recalled, and available quantities. `inventory_item_location_balances` rolls those values up by item/location. `inventory_in_transit_balances` derives dispatched-but-unreceived transfer quantity. None of these views is directly editable.

Completed receipt lines, condition events, recall-lot links, ledger entries, audit records, and transfer receipts are immutable. State-transition and scope triggers are final integrity boundaries; application services remain the source of workflow and authorization decisions.

PostgreSQL 18 is installed natively on Windows. `food_pantry_dev` and `food_pantry_test` are separate databases owned by the non-superuser `pantry_app` role. The application uses Drizzle ORM with reviewed, ordered SQL migrations under `drizzle/`.

The Prompt 2 foundation contains Better Auth tables (`user`, `session`, `account`, `verification`) and domain tables for profiles, organizations, pantry locations, organization/location memberships, permissions, roles, role permissions, membership roles, invitations, operation requests, audit logs, and development-only messages.

Identifiers use UUIDs. Dates use `timestamptz`. Unique and composite foreign keys prevent duplicate membership and cross-organization location, audit, and membership relationships. Partial indexes protect active role assignment and pending invitation uniqueness. Organization slugs are globally unique; location slugs are unique within an organization.

Database triggers provide final integrity boundaries: updated timestamps, identity/profile synchronization, active-parent validation, role/location scope validation, final-administrator protection, final-active-location protection, and append-only audit history. Application services still validate and authorize before writes; triggers do not replace domain behavior.

`pnpm db:migrate` applies development migrations. `pnpm db:test:reset`, `db:test:migrate`, and `db:test:seed` operate only on the guarded local test database. Schema synchronization is not a deployment strategy.
