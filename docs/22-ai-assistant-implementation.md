# Controlled AI Assistant Implementation

## Status and scope

The full tool registry from [`08-ai-assistant-design.md`](./08-ai-assistant-design.md) is implemented: 15 permission-scoped read tools and 7 proposal-only actions, backed by a locally hosted Ollama model. No request the assistant makes on the model's behalf ever leaves the machine, and the application does not depend on any AI provider being configured or reachable.

The application continues to use native PostgreSQL and trusted server-only access. Assistant authorization is enforced in the same service boundary used by the rest of the application; the assistant is never itself an authorization boundary.

## Architecture

1. A signed-in user opens a conversation bound to their current organization and pantry location.
2. The server derives the actor, organization, and location. Neither prompt text nor tool input may supply a different organization or location.
3. `getAssistantProvider()` selects `ollama` (local model, tool-calling) or `disabled`. The deterministic provider remains an internal safety fallback when Ollama is unavailable.
4. A fixed server registry (`ASSISTANT_TOOL_REGISTRY` in `src/domains/assistant/tools.ts`) validates tool input with strict Zod schemas and rejects unknown fields.
5. Each read tool independently rechecks `assistant.use` and its domain permission before querying.
6. A fresh canonical PostgreSQL query returns a capped, minimized result with its location, timestamp, basis, warnings, and confidence classification.
7. A hand-written deterministic template (`safeToolResponse()`) summarizes the exact returned values — the model never authors the user-facing summary text, eliminating hallucination risk regardless of which provider answered. The structured source result remains visible beside the conversation.
8. Proposal creation is never reachable from the chat/model path — it is invoked only by permission-gated server actions the UI calls after a human reviews a read result and fills out a form.
9. Tool telemetry is append-only. Raw hidden prompts, secrets, and unrestricted database data are not logged.

## Provider behavior

`AssistantProvider` is an internal abstraction (`src/domains/assistant/provider.ts`). Three implementations exist:

- **`OllamaAssistantProvider`** (`ASSISTANT_PROVIDER=ollama`) calls the local Ollama server's `POST {OLLAMA_ASSISTANT_BASE_URL}/v1/chat/completions` endpoint with the restricted 15 read-tool schemas. The system prompt instructs the model to never answer from its own knowledge and to only ever select one tool. On any failure — unreachable server, non-OK response, timeout (`OLLAMA_ASSISTANT_TIMEOUT_MS`, default 30s), or a malformed tool call — it falls back automatically to the deterministic safety provider rather than hanging or erroring. No data ever leaves the machine: the base URL defaults to `http://127.0.0.1:11434`.
- **`LocalDeterministicAssistantProvider`** (default, and the automatic fallback) selects an allowlisted read tool by keyword match for all 15 read tools. It never fabricates a database fact and requires no model at all.
- **`DisabledAssistantProvider`** (`ASSISTANT_PROVIDER=disabled`) reports provider unavailability while leaving the core application and approved read-tool UI usable.

## Full tool registry

**Read tools** (model-selectable; require `assistant.use` + a domain permission):

| Tool | Permission | Behavior |
| --- | --- | --- |
| `get_inventory_summary` | `inventory.view` | Aggregate on-hand/reserved/quarantined/expired/available balances |
| `search_inventory_items` | `inventory.view` | Catalog search by name, capped at 50 results |
| `get_inventory_item_details` | `inventory.view` | One item's category, base unit, conversions, balance |
| `get_inventory_lot_history` | `inventory.view` | Immutable ledger history for one lot |
| `get_inventory_transaction_history` | `inventory.view` | Recent ledger entries for one item, lookback capped at 90 days |
| `get_shortage_forecast` | `forecast.view` | Latest deterministic shortage forecast, horizon capped at 90 days |
| `get_category_forecast` | `forecast.view` | Forecast rolled up by category |
| `get_expiring_inventory` | `inventory.view` | Lots expiring within the requested window |
| `get_active_alerts` | `alert.view` | Open/acknowledged alerts, capped at 50 |
| `get_upcoming_appointments` | `appointment.view` | Upcoming pickups: time, household display name, status only |
| `get_pickup_counts` | `appointment.view` | Aggregate pickup counts by status; no household list |
| `get_household_pickup_status` | `household.view_basic` | Status for exactly one household by exact ID; not a search tool |
| `get_sms_delivery_summary` | `message.view` | Aggregate delivery counts; no bodies or phone numbers |
| `get_recent_donations` | `donation.view` | Recent donation records; no donor contact information |
| `get_operational_metrics` | `dashboard.view_operations` | Dashboard-style aggregate metrics for the location |

**Proposal tools** (never model-callable; created only by a permission-gated UI form/server action, require `assistant.propose_actions` + a domain permission):

| Tool | Domain permission | Risk | Confirms via |
| --- | --- | --- | --- |
| `propose_alert_acknowledgement` | `alert.view` | low | `transitionAlert` |
| `draft_sms_message` | `assistant.draft_message` | low | reviewed only, never sent |
| `draft_bulk_announcement` | `assistant.draft_message` | medium | `createMessageCampaign` (draft status only, never sent) |
| `create_inventory_adjustment_proposal` | `inventory.adjust` | medium | `recordAdjustment` (unit resolved server-side, never from caller/model input) |
| `create_reservation_proposal` | `reservation.create` | medium | `createReservation` |
| `create_donation_needs_report` | `donation.view` | low | re-reads `latestDonationNeeds` fresh, no domain mutation |
| `create_pickup_reschedule_proposal` | `assistant.propose_reschedule` | medium | `rescheduleAppointment` |

Confirming any proposal also requires `assistant.confirm_low_risk` or `assistant.confirm_high_risk` (whichever `confirmGatePermission()` maps the proposal's risk level to) plus the matching `PROPOSAL_CONFIRM_PERMISSION` domain permission — both re-checked fresh at confirm time, independent of what was checked at proposal-creation time.

There is no dynamic tool loading, arbitrary SQL, schema browsing, URL retrieval, shell execution, direct SMS-send tool, or direct inventory-write tool. `create_inventory_adjustment_proposal` never accepts a unit from the caller or the model — the unit is resolved from the lot's item server-side, following the application-wide rule to never trust a client-supplied conversion factor or unit.

## Permission and scope enforcement

Every read tool requires `assistant.use` plus its domain permission. Every proposal tool requires `assistant.propose_actions` plus its own domain permission (see table above) — this is enforced as a layer independent of, and in addition to, the same domain permission a user might already hold to perform that action directly through the ordinary UI. A worker with `inventory.adjust` but without `assistant.propose_actions` can still adjust inventory through the normal Inventory page but cannot propose an adjustment through the assistant; this is deliberate scoping (see the seed role matrix in `scripts/db-seed.ts`), not a gap.

The server validates that the pantry location belongs to the organization and that the user has an active membership and effective permission in that location. Conversation reads are additionally restricted to the creating user. Suspended memberships fail the existing permission query. SQL predicates always include organization and location identifiers derived by the server, never accepted from tool input.

## Prompt-injection and privacy controls

Prompt text and all retrieved database text are untrusted data. `assessPromptSafety()` refuses common requests to reveal hidden prompts, execute SQL or code, bypass authorization or consent, enumerate contacts, or act on another organization, and refuses unsupported SMS-send, inventory-mutation, household-deletion, and role-change instructions before tool selection — the Ollama provider checks this before ever calling the model.

`toolOutputIsMinimized()` is a defense-in-depth check applied to every read-tool and proposal-preview payload before it can reach a message: it rejects output containing any of a banned-field list (`phone_number`, `email_address`, `dietary`, `allergen`, `consent`, `date_of_birth`, `ssn`, `password`, `api_key`, `database_url`, `auth_token`, and related fields), independent of what each tool's SQL query was already scoped to select.

Read results are deliberately aggregate or operational:

- no phone numbers, email addresses, household notes, dietary details, passwords, tokens, or database URLs;
- capped row counts and horizons, enforced per-tool in each Zod schema;
- no broad household search tool — `get_household_pickup_status` requires an exact ID;
- no donor or household contact fields;
- no raw database or provider errors are shown in the browser.

Conversation prompts are capped at 1,000 characters and the UI warns users not to enter sensitive data.

## Proposal and confirmation model

All 7 proposal types share one generic flow (`insertProposal()` / `confirmProposal()` / `executeConfirmedProposal()` in `src/domains/assistant/service.ts`):

1. A permission-gated server action validates input against a `.strict()` Zod schema, loads the current state of the record being proposed against (for the 4 proposal types with a mutable backing record: the alert, lot, or appointment), and computes a SHA-256 state fingerprint of it.
2. The proposal is inserted with a unique idempotency key (`unique(organization_id, idempotency_key)`, `on conflict do nothing returning ...`) and expires after 15 minutes. Reusing an idempotency key with a different payload rejects with `CONFLICT` rather than silently returning the wrong proposal.
3. Creating or discussing a proposal performs no domain action.
4. A separate confirmation control (not chat text) submits to `confirmProposalAction`.
5. `confirmProposal()` locks the proposal row, rejects if already `rejected`/`expired`/`stale`/`failed`, marks `expired` if past its 15-minute window, and re-fetches the live backing record: if its fresh fingerprint no longer matches the one stored at proposal time, the proposal is marked `stale` and confirmation rejects with `CONFLICT` instead of executing against a record that moved.
6. Confirmation then independently re-checks `confirmGatePermission()` (`assistant.confirm_low_risk`/`assistant.confirm_high_risk`) and the proposal's `PROPOSAL_CONFIRM_PERMISSION` domain permission — fresh, not reused from proposal-creation time.
7. `executeConfirmedProposal()` dispatches to the real, already-existing domain command (`transitionAlert`, `recordAdjustment`, `createReservation`, `rescheduleAppointment`, `createMessageCampaign`), which independently re-validates and re-authorizes before writing anything.
8. The proposal is marked `executed` with a minimized result. Repeated confirmation of an already-executed proposal returns the stored result without repeating the domain action.
9. A high-risk inventory adjustment (above the existing risk-tiered approval threshold) returns a `pending_approval` adjustment request rather than a posted transaction — the assistant never bypasses that separate human-approval chain.

The assistant cannot confirm a proposal through chat text under any circumstance: only the read tools are ever exposed to the model, and only an explicit UI confirm button can execute a proposal.

## Storage and audit

The shared migration provides:

- `ai_conversations`
- `ai_messages`
- `ai_tool_runs`
- `ai_action_proposals`

Tool runs are append-only at the database boundary (a direct `UPDATE` against `ai_tool_runs` is rejected with `APPEND_ONLY_RECORD`). Conversations, messages, tool runs, and proposals retain organization/location ownership. Proposal-created and proposal-executed audit events are separate from each domain's own status-transition audit (e.g. an alert acknowledgement is audited once by the assistant and once by the alert domain).

## User interface

`/app/[organizationSlug]/assistant` shows the fixed scope, safety boundary, conversation list, and registered tools. The conversation page provides:

- a scoped-question form describing the full 15-tool read surface;
- visible conversation history;
- expandable structured source results for every tool run;
- one permission-gated proposal-creation form per proposal type (alert acknowledgement, draft SMS, draft bulk announcement, inventory adjustment, reservation, donation-needs report, pickup reschedule), each shown only to actors holding its required permission;
- a generic proposal listing rendering a title, risk level, status, and relevant payload fields per proposal type, with per-proposal confirm eligibility computed from `PROPOSAL_CONFIRM_PERMISSION`/`confirmGatePermission()` — the same source of truth the server uses, so a confirm button is never shown for a permission the server would reject;
- empty and loading states; keyboard-visible links, labeled controls, status text, and live action feedback.

## Tests

Unit coverage (`src/domains/assistant/assistant-policy.test.ts`, `src/lib/env.test.ts`) verifies:

- injection and data-enumeration refusal;
- strict schemas and rejection of caller-supplied organization scope;
- stable state fingerprints;
- proposal expiry boundaries;
- restricted-field detection across the expanded banned-field list;
- every read and proposal tool has a matching, closed JSON-Schema tool definition;
- every proposal tool has a domain permission, risk level, and confirm permission;
- `confirmGatePermission()` routes to the correct permission for each proposal's recorded risk level;
- the deterministic provider's fixed-tool selection across all 15 read tools;
- the Ollama provider: calls only the configured local base URL, never selects a tool outside the caller's allowed list, falls back to the deterministic provider on network failure or a non-OK response, and never calls the model at all for an unsafe prompt;
- disabled-provider behavior;
- `ASSISTANT_PROVIDER`/`OLLAMA_ASSISTANT_*` environment schema validation (defaults, valid `ollama` configuration, rejection of an unrecognized provider, a non-URL base URL, and an out-of-range timeout).

Each user/location has a database-backed five-minute request window capped at 30 turns. `pnpm ai:retention` archives active conversations older than `AI_CONVERSATION_RETENTION_DAYS` (default 90) without deleting the immutable message history.

Native PostgreSQL integration coverage (`tests/integration/assistant.test.ts`) verifies:

- a scoped factual query and minimized output;
- append-only tool-run enforcement;
- stale proposal detection (a changed alert after proposal creation rejects confirmation with `CONFLICT` and marks the proposal `stale`);
- one-time confirmed action execution and idempotent repeated confirmation;
- idempotency-key reuse with a different payload is rejected;
- cross-organization denial;
- a manager confirming an inventory adjustment proposal resolves the unit server-side and posts exactly one immutable transaction;
- the assistant's proposal-creation permission gate is independent of the underlying domain permission (a worker with `inventory.adjust` is still denied `create_inventory_adjustment_proposal` without `assistant.propose_actions`).

## Known limitations

- Ollama must be run and reachable separately (e.g. `ollama serve` with `qwen2.5:7b` pulled); the application does not manage the Ollama process itself. If it is not configured or not reachable, the deterministic keyword router keeps the read-tool surface usable with no degradation in safety guarantees.
- There is no automatic conversation-retention/archive job yet.
- Assistant rate limiting currently relies on the application/session boundary; a dedicated per-user request limiter is not implemented.
- The assistant UI exposes structured JSON source envelopes for auditability rather than a richer table renderer.
