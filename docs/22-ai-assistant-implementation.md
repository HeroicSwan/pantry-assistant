# Controlled AI Assistant Implementation

## Status and scope

Prompt 7 adds a deliberately narrow operations-assistant slice. The application does not depend on an AI provider and does not give a model database credentials, SQL access, messaging access, or inventory mutation access. The initial implementation supports three permission-scoped read tools and one proposal-only action.

The application continues to use native Windows PostgreSQL and trusted server-only access. Assistant authorization is enforced in the same service boundary used by the rest of the application.

## Architecture

1. A signed-in user opens a conversation bound to their current organization and pantry location.
2. The server derives the actor, organization, and location. Neither prompt text nor tool input may supply a different organization.
3. The local deterministic provider classifies a small set of supported intents. It does not answer factual questions itself.
4. A fixed server registry validates tool input with strict Zod schemas and rejects unknown fields.
5. Each tool independently rechecks `assistant.use` and its domain permission.
6. A fresh canonical PostgreSQL query returns a capped, minimized result with its location, timestamp, basis, warnings, and confidence classification.
7. The deterministic formatter may summarize those exact values. The structured source result remains visible beside the conversation.
8. Tool telemetry is append-only. Raw hidden prompts, secrets, and unrestricted database data are not logged.

## Provider behavior

`AssistantProvider` is an internal abstraction. Two implementations exist:

- `LocalDeterministicAssistantProvider` selects only an allowlisted read tool for recognizable inventory, forecast, or alert questions. It never fabricates a database fact.
- `DisabledAssistantProvider` reports provider unavailability while leaving the core application and approved quick-query architecture usable.

No OpenAI SDK or key is required for local development. A future external provider can implement the interface, but it must receive only the fixed tool descriptions and must not become an authorization boundary.

## Fixed tool registry

| Tool                            | Class    | Permission                  | Behavior                                                                                                                                                 |
| ------------------------------- | -------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_inventory_summary`         | Read     | `inventory.view`            | Returns capped per-item physical, reserved, quarantined, expired, and available quantities from the canonical balance view without summing unlike units. |
| `get_shortage_forecast`         | Read     | `forecast.view`             | Returns up to 25 at-risk results from the latest completed deterministic snapshot. Forecast values remain labeled estimates.                             |
| `get_active_alerts`             | Read     | `alert.view`                | Returns at most 50 open or acknowledged alerts. Alert text is explicitly treated as untrusted record data.                                               |
| `propose_alert_acknowledgement` | Proposal | `assistant.propose_actions` | Stores a low-risk acknowledgement preview. Creating it does not update the alert.                                                                        |

There is no dynamic tool loading, arbitrary SQL, schema browsing, URL retrieval, shell execution, SMS send tool, or inventory write tool.

## Permission and scope enforcement

Every tool requires `assistant.use` plus its domain permission. Proposal creation also requires `assistant.propose_actions` and alert visibility. Confirmation requires both `assistant.confirm_low_risk` and `alert.acknowledge`.

The server validates that the pantry location belongs to the organization and that the user has an active membership and effective permission in that location. Conversation reads are additionally restricted to the creating user. Suspended memberships fail the existing permission query. SQL predicates always include organization and location identifiers derived by the server.

## Prompt-injection and privacy controls

Prompt text and all retrieved database text are untrusted data. The policy refuses common requests to reveal hidden prompts, execute SQL or code, bypass authorization or consent, enumerate contacts, or act on another organization. Unsupported SMS, inventory mutation, household deletion, and role-change instructions are refused before tool selection.

Read results are deliberately aggregate or operational:

- no phone numbers, email addresses, household notes, dietary details, passwords, tokens, or database URLs;
- capped row counts and horizons;
- no broad household search tool;
- no donor or household contact fields;
- record titles and summaries are truncated and labeled untrusted;
- no raw database or provider errors are shown in the browser.

Conversation prompts are capped at 1,000 characters and the UI warns users not to enter sensitive data. A production retention job for archived conversations is not yet implemented.

## Proposal and confirmation model

Alert acknowledgement is the only executable proposal in this slice. It demonstrates the complete controlled flow:

1. Proposal creation validates the alert in the current organization/location.
2. The stored payload includes the exact target, reason, expected alert state, and a stable SHA-256 state fingerprint.
3. The proposal receives a unique idempotency key and expires after 15 minutes.
4. Creating or discussing the proposal performs no domain action.
5. A separate confirmation form requires deliberate user input.
6. Confirmation reloads permissions, proposal status, expiry, and current alert state.
7. Changed state marks the proposal `stale`; expired state marks it `expired`.
8. A valid confirmation calls the existing trusted `transitionAlert` domain service, which reauthorizes and writes its own audit/event records.
9. The proposal is marked `executed` with a minimized result. Repeated confirmation returns the stored result and does not create another alert transition.
10. A recovery path recognizes an already-acknowledged alert after an interrupted confirmation and records the proposal as executed without repeating the action.

The assistant cannot confirm a proposal through chat text. It cannot send messages, change inventory, approve high-risk changes, or select an action type dynamically.

## Storage and audit

The shared Prompt 7 migration provides:

- `ai_conversations`
- `ai_messages`
- `ai_tool_runs`
- `ai_action_proposals`

Tool runs are append-only at the database boundary. Conversations, messages, tool runs, and proposals retain organization/location ownership. Proposal-created and proposal-executed audit events are separate from the alert domain's own status-transition audit.

## User interface

`/app/[organizationSlug]/assistant` shows the fixed scope, safety boundary, conversation list, and registered tools. The conversation page provides:

- a supported-question form;
- visible conversation history;
- expandable structured source results;
- proposal creation for an eligible open alert;
- proposal status, risk, expiry, reason, and explicit confirmation;
- empty and loading states;
- keyboard-visible links, labeled controls, status text, and live action feedback.

## Tests

Unit coverage verifies:

- injection and data-enumeration refusal;
- strict schemas and rejection of caller-supplied organization scope;
- stable state fingerprints;
- proposal expiry boundaries;
- restricted-field detection;
- deterministic fixed-tool selection;
- disabled-provider behavior.

Native PostgreSQL integration coverage verifies:

- a scoped factual query and minimized output;
- append-only tool-run enforcement;
- stale proposal detection;
- one-time confirmed action execution;
- idempotent repeated confirmation;
- cross-organization denial.

## Known limitations

- There is no configured external language-model provider. The deterministic fallback recognizes only inventory, shortage-forecast, and active-alert questions.
- Alert acknowledgement is the only confirmable action; inventory, reservation, appointment, report, and messaging proposals remain unavailable.
- There is no automatic conversation-retention/archive job yet.
- Assistant rate limiting currently relies on the application/session boundary; a dedicated per-user request limiter is not implemented in this slice.
- The assistant UI exposes structured JSON source envelopes for auditability rather than a richer table renderer.
