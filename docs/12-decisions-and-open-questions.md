# Decisions and open questions

## Settled foundation decisions

- The project remains independent from the volunteer scheduling application.
- Native Windows PostgreSQL 18 is the local database.
- Drizzle with `pg` is the sole database layer.
- Better Auth is the sole authentication/session system.
- Server-side authorization uses active membership, scoped roles, location assignments, and transactional rechecks.
- Version-controlled migrations and separate development/test databases are mandatory.
- The test reset rejects unsafe database targets.
- Audit history is append-only and final-administrator removal is blocked.

## Deferred product questions

Before their respective future phases, confirm pantry operating calendars, fractional inventory quantities, adjustment thresholds, reservation expiry, supported languages, retention periods, forecast parameters, SMS sender/country rules, household privacy policy, deployment region/provider, and backup/restore objectives.

None of these questions blocks the completed Prompt 2 foundation.
