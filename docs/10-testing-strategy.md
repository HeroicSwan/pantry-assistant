# Testing strategy

## Prompt 4 coverage

Pure unit tests cover adjustment risk and transfer/count state policies. Native PostgreSQL integration tests rebuild `food_pantry_test` and verify multi-line receipt atomicity/idempotency, separate approval, condition holds, partial transfer receipts, in-transit balances, cross-organization denial, append-only records, and concurrent negative-stock prevention.

Playwright covers the administrator donation-to-receipt flow on desktop and mobile plus volunteer denial. `pnpm test:e2e` always resets, migrates, and seeds only the isolated local test database before building and starting the production server.

Vitest unit tests cover schemas, slug handling, active-scope selection, effective permissions, and safe redirect behavior. Native PostgreSQL integration tests use only `food_pantry_test` and verify Better Auth sign-in/invalid credentials, the non-superuser connection, organization/location permission isolation, suspension denial, transactions and rollback, server service writes, composite foreign keys, uniqueness, final-administrator protection, and audit immutability.

Playwright runs against a production Next.js server whose `DATABASE_URL` is overridden with `TEST_DATABASE_URL`. Its script resets, migrates, and seeds the test database first. Desktop and mobile projects exercise administrator pages and writes, invitation preparation, manager and volunteer denials, read-only controls, suspended access, cross-organization guessing, sign-up, and atomic onboarding.

```powershell
pnpm test
pnpm test:integration
pnpm test:e2e
```

Destructive test setup refuses to run unless `NODE_ENV=test`, the host is local, the database name ends in `_test`, and development/test URLs differ. Development data is never reset by tests. External SMS or AI calls are excluded until their later phases and must use fakes or provider test credentials by default.
