# Households and pickups implementation

Prompt 5 is implemented on the existing native Windows PostgreSQL architecture. It does not use Docker, Supabase, hosted services, browser-direct database access, or Supabase RLS.

## Delivered foundation

- Organization-scoped households, contacts, preferences, duplicate detection, and append-only SMS-consent history.
- Package templates, item/category lines, household-size multipliers, appointment allocation snapshots, and recurring-series schema support.
- Location-scoped appointments with status history, check-in, cancellation, no-show, and rescheduling flows.
- FEFO inventory reservations that reduce derived availability without posting physical inventory movement.
- Pickup completion that posts immutable `pickup_fulfillment` ledger transactions only after check-in. Corrections create reversals rather than editing the original fulfillment.
- Server-only services, explicit permission checks, composite organization/location foreign keys, state-transition triggers, audit events, and integration coverage.

## Local workflow

Run native PostgreSQL first, then use `pnpm db:migrate`, `pnpm db:seed`, and `pnpm dev`. Use `pnpm test:db` for the isolated `food_pantry_test` migration, seed, and integration workflow.

## Current limitations

Recurring appointment series now have a bounded native worker (`pnpm appointments:run-jobs`) that generates scheduled occurrences through a rolling horizon. Duplicate candidates remain review-first, while administrators with `household.merge` can perform an audited, transactional merge that moves linked operational records and marks the source as merged. SMS consent now drives the final-phase messaging eligibility service; consent history itself remains append-only.
