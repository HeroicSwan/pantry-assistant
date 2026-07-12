# Native Windows PostgreSQL migration

## Why the infrastructure changed

The original Prompt 2 foundation depended on a local Supabase stack whose CLI required Docker and virtualization. This Windows computer cannot use that stack reliably. The replacement preserves product behavior while removing Docker, Supabase, browser-direct database access, and hosted-service requirements.

## Previous and current architecture

Previously, authentication used Supabase Auth, browser/server clients called PostgREST and RPC endpoints, SQL policies depended on `auth.uid()`, and local database tests depended on containers.

Now, Next.js runs directly on Windows; Better Auth stores identities, credential accounts, verification records, and sessions in PostgreSQL; Drizzle and `pg` provide a central server-only pool; repositories and services require user, organization, and location context; and reviewed SQL migrations enforce relational integrity. Browser components never receive a database URL or database client.

## Installation result

- PostgreSQL: 18.4, newly installed from the official Windows installer.
- Windows service: `postgresql-x64-18`, running with automatic startup.
- Listener: localhost port 5432.
- Development database: `food_pantry_dev`.
- Test database: `food_pantry_test`.
- Application role: `pantry_app`, login enabled, non-superuser, no role/database creation privileges.

The ignored local setup file retains generated administrator/application credentials. The ignored application environment contains URL-encoded development/test URLs and Better Auth secrets. No secret is committed or documented.

## Preserved Prompt 2 behavior

Profiles, organizations, locations, organization/location memberships, roles, permissions, role assignments, invitations, active scope selection, onboarding, settings, location/team administration, protected navigation, suspension denial, final-administrator protection, cross-scope isolation, and audit history were preserved.

## Database and authentication migration

`drizzle/0000_native_foundation.sql` creates 17 tables, PostgreSQL enums, foreign keys, composite scope constraints, partial uniqueness, indexes, profile synchronization, timestamp maintenance, final-administrator/final-location guards, assignment validation, and audit immutability. `0001_native_trigger_fixes.sql` permits safe archival while retaining administrator protections. Drizzle records applied migrations in its own schema.

Better Auth uses its Drizzle adapter and default scrypt password hashing. Sessions resolve on the server. Next.js Proxy only performs an optimistic cookie presence redirect; pages, queries, actions, services, and database constraints independently enforce authorization. Local password-reset delivery is recorded in the server-only `development_messages` table pending a future production email adapter.

## Environment and test safety

`.env.example` exposes placeholders only. The test reset requires `NODE_ENV=test`, localhost, a distinct URL, and an `_test` database name. It clears both application and migration schemas only in `food_pantry_test`. Seeds use Better Auth password hashing and reserved fictional addresses.

Unit tests cover pure policies and schemas. Native integration tests verify authentication, PostgreSQL identity, permissions, cross-scope constraints, rollback, service writes, final-administrator enforcement, and audit immutability. Playwright resets the test database and exercises desktop/mobile sign-in, sign-up, onboarding, administrator writes, role-limited navigation, suspended access, and organization isolation.

## Remaining production limitations

Production email delivery, rate limiting/bot protection, MFA/SSO policy, managed monitoring, and documented backup/restore drills remain deployment work. They do not create a local Docker or hosted-database dependency.
