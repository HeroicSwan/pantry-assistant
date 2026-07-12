# Security and privacy

## Inventory operations controls

Inventory PostgreSQL access remains server-only. Each operational service resolves the active organization membership, checks the required organization or location permission, scopes every record by organization/location, and writes an audit event inside the same transaction. Composite foreign keys and database triggers reject cross-location lots, count entries, transfer lines, and receipts even if a service regression supplies a known UUID.

High-risk adjustments, transfer approval, and reconciliation require elevated permission and separate actors. Quarantine release, recall resolution, cancellation, correction, and discrepancy resolution use distinct permission keys. Raw database connection details and driver errors are never returned to client components.

This native design does not use Supabase RLS. The equivalent trust boundary is a server-only application role plus mandatory scoped repositories/services, PostgreSQL constraints, and direct-invocation isolation tests.

Better Auth owns password and session security. Passwords use the library's scrypt implementation; plaintext passwords are never stored. Session resolution occurs server-side, sign-out invalidates the session, password reset revokes sessions, and cookies are managed by the auth library. Proxy cookie checks are not authorization.

All database access is server-only. There is no public database URL, browser database client, administrator credential in application runtime, or service-role bypass. The application uses the least-privileged `pantry_app` role.

Every sensitive command resolves the session, validates input with Zod, checks active membership and permission, verifies organization/location ownership, performs atomic writes, and records an audit event. Services recheck permission inside the transaction. Suspended and archived memberships fail authorization. Known UUIDs do not bypass scope.

Composite foreign keys prevent cross-organization assignments. Location roles require an active location membership. Expired roles do not grant access. Final active administrators and final active locations have application and database protections. Audit updates and deletes fail at the database boundary.

Local secrets live only in ignored `.env.local` and `.env.setup.local`; placeholders live in `.env.example`. Database URLs are never public environment variables or logged in full. Errors returned to browsers are mapped to safe codes/messages with request IDs.

Production deployment still requires an email provider, rate limiting/abuse controls, CSP/security-header review, monitoring, backup/restore drills, and incident procedures. Those adapters must stay server-only.
