# Repository assessment

This is an independent greenfield food-pantry application under `Claude Crops`. The neighboring volunteer scheduling project is unrelated and was not modified or reused.

The repository now contains a Next.js 16/TypeScript modular monolith, Better Auth identity/session handling, a central server-only Drizzle/PostgreSQL layer, ordered migrations, fictional seeds, unit/integration/E2E tests, and documentation. Prompt 2 implements only the identity, organization, location, membership, permission, onboarding, administration, and audit foundation.

Native PostgreSQL 18 supplies the local database through a Windows service. Browser database access and public database credentials are prohibited. Trusted server services own mutations and enforce user, organization, and location scope.

Future operational domains—inventory, donations, households, appointments, forecasting, SMS, assistant, and reports—remain design work and must not be inferred as implemented.
