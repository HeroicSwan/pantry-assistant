# Advanced capabilities

Pantry Assistant's advanced features are local-first and disabled by default where an automated decision could affect food, money, or household access.

## Forecasting

The hybrid model combines a local linear trend with learned weekday/month factors and explicit causal events. It is stored as an immutable forecast snapshot with model metadata in `explanation`. The model does not send data to a hosted ML provider.

## Autonomous operations

Location-scoped automation policies can be enabled for purchase replenishment, expired-stock disposal, inventory adjustments, and transfers. Policies can run in review-only mode or autonomous mode. Purchase orders, disposal transactions, and ledger mutations use the normal server-side services, idempotency keys, authorization checks, and audit records. Transfers require a distinct approver identity when autonomous dispatch is enabled.

## Queueing

`job_queue` is a durable PostgreSQL-backed queue with row locking, retry limits, backoff, and dead-letter status. Run `pnpm queue:worker <queue> <limit>` from Task Scheduler or another local supervisor.

## Reports and AI presentation

Managers can save reusable report layouts under Reports → Report designer. Existing report routes now support `format=pdf` through a server-side PDF generator. Assistant source results render as tables and proportional charts when the returned structure supports it.

## Attachments and eligibility

Attachments are stored under the ignored local `data/attachments` directory and recorded with SHA-256 metadata. Eligibility verification is manual and auditable; no government system is queried automatically. The compliance API stores country-specific rules and keeps SMS consent enforcement enabled.

## Autonomous AI writes

The `ASSISTANT_AUTONOMOUS_WRITES_ENABLED` environment flag is false by default. When enabled, only users with the explicit `assistant.autonomous_write` permission can enqueue the fixed purchase-order or expired-stock action types. `pnpm ai:writes` executes queued actions through ordinary domain services; arbitrary SQL or arbitrary model-selected operations are not allowed.
