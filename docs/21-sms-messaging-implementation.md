# SMS messaging implementation

## Scope

Prompt 7 adds a consent-first SMS subsystem without changing the application’s native Windows PostgreSQL and server-only authorization architecture. It includes templates, individual sends, audience previews, approval-gated campaigns, appointment reminder preparation, inbound command handling, delivery status processing, bounded retries, and simulation mode.

SMS is not an authorization channel. Incoming free-form text cannot invoke arbitrary application operations.

## Provider modes

- `disabled` prevents new dispatches.
- `simulation` is the development default. It creates normal message/event records but never makes a network request.
- `twilio_test` uses the Twilio REST endpoint with server-only test credentials.
- `live` requires administrator permission, explicit confirmation, complete server credentials, and a configured sender or Messaging Service.

The provider boundary uses the built-in `fetch` API rather than coupling business services to a vendor SDK. Provider acceptance is recorded as acceptance; it is never reported as delivery. Simulation messages are visibly labeled with provider `simulation`.

Server-only Twilio configuration uses:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_PHONE_NUMBER`
- `TWILIO_WEBHOOK_BASE_URL` for the exact public webhook origin

Credentials are not stored in messaging tables, rendered into client components, included in audit payloads, or returned by provider failures.

## Consent eligibility

`evaluateSmsRecipientEligibility` is the canonical pure eligibility rule. Every dispatch reloads the latest append-only `sms_consents` record and verifies:

- a valid normalized E.164 number;
- an active household and contact;
- matching organization and location scope;
- a current `consented` record linked to the intended contact or household;
- no audience duplicate;
- no incompatible appointment state; and
- no current quiet-hours restriction.

Draft-time or approval-time consent never guarantees send-time eligibility. STOP immediately creates a newer `opted_out` consent event, which blocks queued messages and retries. START can create a new consent event only for a known prior consent relationship; it does not enroll an unknown phone number.

## Templates and message snapshots

Templates support explicit `{{variable_name}}` placeholders. Rendering returns missing variables, encoding, character count, and estimated SMS segments. Messages with missing variables, empty bodies, or more than ten segments are rejected. A sent or scheduled message stores its exact body and consent relationship so later template edits cannot rewrite history.

Reminder variables are deliberately limited to household display name, appointment date/time, pantry location/address, and contact phone. Sensitive notes, dietary data, inventory details, database identifiers, and authentication links are excluded.

## Individual and campaign sends

Individual messaging uses a two-step review and confirmation screen. It displays the recipient, masked phone number, current eligibility, exact body, encoding, character count, segment count, language, and schedule before accepting the confirmed action.

Campaigns proceed through `draft → awaiting_approval → approved → sending`. Their audience definition and body are snapshotted. The approval page shows exact current matched, eligible, excluded, duplicate, invalid, and opted-out totals. Send execution recalculates the audience, deduplicates normalized phone numbers, records exclusions, creates one idempotent logical message per recipient, and rechecks consent during dispatch. Cancelled campaigns cannot create further messages.

The current worker processes at most 100 campaign messages per invocation. This is an intentional local rate-control boundary; production job orchestration should invoke the worker repeatedly rather than bypassing it.

## Appointment reminders and jobs

`scheduleAppointmentReminders` finds scheduled or confirmed appointments entering each location’s configured reminder window, resolves the preferred-language template, checks consent, renders a body, and inserts an idempotent queued message. Completed, cancelled, no-show, and rescheduled-original appointments are excluded.

`runMessagingJobs` performs:

1. reminder preparation;
2. due-message dispatch; and
3. bounded retry processing.

The functions are safe for a trusted local scheduler or production cron route. Automatic Windows Task Scheduler registration is not included in this slice.

## Inbound and status webhooks

The trusted routes are:

- `/api/webhooks/twilio/inbound`
- `/api/webhooks/twilio/status`

Both require a valid `X-Twilio-Signature`. Validation uses the exact configured public URL, sorted form parameters, HMAC-SHA1, and constant-time comparison. Forwarded host headers are not trusted. Only a minimized provider payload is retained.

Inbound provider IDs and status-event fingerprints are unique, so replayed webhooks do not repeat side effects. Compliance commands are case-insensitive and processed before appointment language:

- STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT opt out all matched active consent relationships.
- START and UNSTOP record a new consent event only for a recognized prior relationship.
- HELP and INFO return the location’s configured help response.
- C, CONFIRM, YES, and Y confirm the next eligible appointment.
- CANNOT ATTEND creates a staff-review item; it does not automatically cancel an appointment.
- Other text remains in the inbound review queue.

Provider events progress monotonically from accepted/queued/sending/sent to a terminal delivery result. Older callbacks cannot overwrite delivered, failed, undelivered, cancelled, or excluded states. Every accepted status callback remains append-only in `sms_events` even when it does not change the current message state.

## Retry policy

Retries are limited by the location setting and use deterministic exponential backoff capped at one hour. Network failures, timeouts, rate limits, and selected temporary carrier errors may retry. Invalid numbers, opt-outs, permanent carrier rejection, missing sender configuration, and exhausted attempts do not. Consent, contact status, household status, location scope, quiet hours, and current provider settings are rechecked before each attempt.

## Authorization and privacy

All staff reads and mutations use effective permission checks at the server boundary. The implementation uses location-scoped permissions such as `message.view`, `message.send_individual`, `message.send_bulk`, `message.approve_bulk`, `message.retry_failed`, `message.manage_inbound`, and `message.settings.manage`. UI visibility is supplementary and never replaces the service check.

Phone numbers are masked in staff lists and previews. Full inbound bodies require the inbound-view permission. Logs and audit events avoid bodies, phone numbers, raw provider payloads, and credentials. Native PostgreSQL constraints and application authorization replace the Supabase-specific RLS assumptions in the original planning prompt.

## Validation

The focused unit suite covers phone normalization, eligibility, deduplication, missing template variables, GSM and Unicode segment counts, quiet hours, STOP precedence, START/HELP/confirmation parsing, bounded retries, provider status ordering, campaign transitions, deterministic idempotency keys, simulation behavior, and Twilio signature validation.

Validated commands for this implementation:

```text
pnpm lint
pnpm typecheck
pnpm test
```

## Known limitations

- Twilio credentials and a publicly reachable HTTPS callback URL are required before live sends can be validated end to end.
- Job functions exist, but scheduler registration and a protected cron entry point must be configured by deployment infrastructure.
- Twilio Messaging Service sender selection uses server environment configuration; the database field stores a nonsecret reference only.
- Campaign processing is bounded and sequential for safety. Large production volumes need a durable queue worker while preserving the same idempotency and consent checks.
- Inbound routing requires a unique enabled location setting whose default sender matches Twilio’s `To` number.
- An inbound cancellation phrase creates a review item rather than cancelling an appointment automatically.
- Compliance acknowledgements are returned as TwiML and are not currently represented as a separate outbound `sms_messages` row.
