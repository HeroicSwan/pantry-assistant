# Architecture decisions

## Inventory operations use services plus database integrity boundaries

Prompt 4 preserves the Prompt 3 Drizzle/ledger architecture. It does not introduce another ORM, authentication system, browser database client, Docker service, or Supabase dependency. Operational state machines live in a server-only service; PostgreSQL constraints and triggers reject impossible scope, mutation, transition, and cumulative-receipt states.

Quarantine and recall are modeled as holds rather than inventory transactions because they change availability without changing physical quantity. Transfers use paired `transfer_out` and `transfer_in` entries because stock belongs to one location at a time. Cycle-count reconciliation refuses stale snapshots instead of silently overwriting intervening ledger activity.

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Next.js 16, TypeScript, pnpm directly on Windows | Matches the existing application and requires no VM layer. |
| Database | Native PostgreSQL 18 Windows service | Reliable local relational database without containers or hosting. |
| Data access | Drizzle ORM plus `pg`, server-only | Typed queries, explicit pooling, and reviewed SQL migrations. |
| Authentication | Better Auth with PostgreSQL | Local email/password identities, scrypt hashes, and secure database sessions. |
| Authorization | Server services plus relational constraints/triggers | Explicit user/organization/location context and defense in depth. |
| Migrations | Version-controlled SQL | Reproducible clean-database setup; no schema push workflow. |
| Audit | Append-only PostgreSQL records | Sensitive actions remain reviewable and normal mutation is blocked. |
| Testing | Separate local test database | Destructive tests cannot affect development data. |

Browser-direct database access, duplicate authentication/ORM systems, hosted database dependencies, public database URLs, and administrator database credentials in application runtime are prohibited.
