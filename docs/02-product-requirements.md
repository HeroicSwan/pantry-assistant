# Product Requirements

## Product purpose

Food Pantry Inventory + SMS Assistant is an operations platform for accurately receiving, reserving, moving, distributing, forecasting, and reporting pantry inventory while coordinating household pickups and consent-aware SMS. Structured records and deterministic calculations are authoritative; AI retrieves, explains, drafts, and proposes but never invents or silently changes operational facts.

## Product principles

1. Ledger before dashboard: every stock change is an immutable transaction.
2. Operations before AI: all useful workflows work without an AI provider.
3. Least privilege at every layer: UI, server, and database enforce the same permissions.
4. Explainability: stock, forecasts, alerts, and assistant answers show their basis and time/location scope.
5. Data minimization: store only household information needed for pickup operations.
6. Human control: disposal, bulk messaging, corrections, overrides, and AI-proposed writes require deliberate user action.

## Users and permission matrix

`A` = allowed, `L` = allowed only for assigned locations or minimized fields, `P` = may prepare/propose but needs manager/admin approval, `—` = denied. Database policies and trusted server commands enforce these boundaries; hidden buttons are not controls.

| Major action                                        |    Administrator    |   Pantry manager    |         Inventory worker          |       Volunteer       |  Read-only  |
| --------------------------------------------------- | :-----------------: | :-----------------: | :-------------------------------: | :-------------------: | :---------: |
| Configure organization, retention, integrations, AI |          A          |          —          |                 —                 |           —           |      —      |
| Manage locations, users, roles                      |          A          |          —          |                 —                 |           —           |      —      |
| View organization reports                           |          A          |          A          |                 L                 |           —           |      A      |
| View audit logs and exports                         |          A          |          A          |                 —                 |           —           |      —      |
| View inventory/transactions                         |          A          |          A          |                 L                 |           L           |      L      |
| Manage items, lots, storage locations               |          A          |          A          |                 L                 |           —           |      —      |
| Receive donations/purchases                         |          A          |          A          |                 L                 |           —           |      —      |
| Record distributions, spoilage, damage              |          A          |          A          |                 L                 |           —           |      —      |
| Manual adjustment below threshold                   |          A          |          A          |                 L                 |           —           |      —      |
| High-impact adjustment or override                  |          A          |          A          |                 P                 |           —           |      —      |
| Create and manage transfers                         |          A          |          A          |                 P                 |           —           |      —      |
| View household operational record                   |          A          |          A          |                 —                 |           L           |      —      |
| Edit household contact/consent                      |          A          |          A          |                 —                 |           —           |      —      |
| View/manage appointments                            |          A          |          A          |                 L                 |           L           |      —      |
| Check in and complete assigned pickups              |          A          |          A          |                 L                 |           L           |      —      |
| Create/modify reservations                          |          A          |          A          |                 L                 |           —           |      —      |
| View forecasts and alerts                           |          A          |          A          |                 L                 | L only assigned tasks | L summaries |
| Draft one-to-one or bulk SMS                        |          A          |          A          |                 P                 |           —           |      —      |
| Approve/send bulk SMS                               |          A          |          A          |                 —                 |           —           |      —      |
| Use AI read tools                                   |          A          |          A          |                 L                 |           L           | L summaries |
| Confirm AI-proposed high-impact action              | Permission-specific | Permission-specific | Only permitted low-impact actions |           —           |      —      |

Administrators are not automatically exempt from location scoping when a membership is explicitly restricted. Platform service processes are not human roles and may act only through narrowly scoped server credentials and audited functions.

## Primary workflows and functional requirements

### Organization and access

- One operating organization with multiple pantry locations from day one.
- Each primary record carries `organization_id`; location-bound records also carry `location_id`.
- Users receive an organization role and optional location memberships.
- Authentication, membership status, permission, and location scope are rechecked for every command.

### Inventory catalog and units

- Manage categories, products, storage locations, units, item-specific conversions, thresholds, dietary attributes, storage requirements, and archive state.
- A product is a reusable definition; a lot is a received batch at one location with received/expiration dates, source, condition, and storage placement.
- Quantities use the item's configured base unit and exact decimal arithmetic. A display unit may be used only when an active conversion version exists.
- Variable-weight goods use a mass base unit and may also track package count as a non-convertible secondary observation; the system never infers weight per package.

### Receiving and donations

- Create one intake containing donor/anonymous source, date, location, notes, and multiple lines.
- Validate unit conversions, lot facts, condition, duplicates, and permissions before commit.
- One atomic completion creates the donation, lots, receipt ledger entries, audit event, and job/outbox markers for projection and alert refresh.
- Attachments and tax receipts are future options, not version-one storage obligations.

### Inventory movement

- Record donation/purchase receipts, distributions, reservations, releases, fulfilled pickups, spoilage, expiration removal, damage, recall/quarantine, transfers, opening balances, manual adjustments, and reversals.
- Historical transactions cannot be updated or deleted. Corrections reference the original transaction or operation group.
- Recommend First Expired, First Out (FEFO); reject expired or quarantined lots.
- Reconciliation records counted quantities and posts separately approved corrections rather than overwriting balances.

### Households, appointments, and pickups

- Store only operational identifiers, contact/consent, language, size bands, dietary/accessibility needs, pickup preferences, status, and restricted notes.
- Support scheduled, recurring-generated, and walk-in appointments with time windows, location, allocation package, reminders, check-in, completion, cancellation, rescheduling, and no-show.
- Detect probable duplicate appointments for the same household/location/window; managers can override with a reason.
- Allocate package demand, reserve lot-level stock using FEFO, partially fulfill when authorized, release unused reservation, and reverse a mistaken completion through a correction workflow.

### Appointment state model

Reminder status is orthogonal to operational status; it must not distort the appointment lifecycle. The UI may display “reminder scheduled/sent,” but the database stores those in reminder/message records.

| Current     | Allowed next states                                 | Notes                                                                                      |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Draft       | Scheduled, Cancelled                                | Scheduling validates household, window, location, and duplicates                           |
| Scheduled   | Confirmed, Arrived, Cancelled, Rescheduled, No-show | Reminder jobs do not change this status                                                    |
| Confirmed   | Arrived, Cancelled, Rescheduled, No-show            | Confirmation may come from staff or verified reply                                         |
| Arrived     | Completed, Cancelled                                | Cancellation after arrival requires reason; stock remains reserved until released          |
| Completed   | none                                                | Correction creates compensating transactions/history; it does not reopen silently          |
| Cancelled   | none                                                | Rebooking creates a new appointment; reservations are released atomically                  |
| No-show     | none                                                | Active reservations release immediately or at a configured grace time                      |
| Rescheduled | none                                                | Terminal pointer to replacement appointment; reservations move by release plus new reserve |

Authorized administrators/managers may use an override command for exceptional transitions; it requires reason, audit, and domain-specific compensation.

### Exception behavior

- Cancellation: atomically cancel and release active reservations; cancel pending reminders.
- Reschedule: create replacement first, reserve if possible, then mark original rescheduled and release/move reservations in one transaction. If new stock is unavailable, keep a conflict proposal and do not discard the original reservation without confirmation.
- No-show: mark terminal, release at policy time, and optionally draft a follow-up only if consent is active.
- Pantry closure: bulk cancel/reschedule proposal, reservation disposition preview, and announcement preview; manager confirms each side effect class.
- Stock loss after reservation: open a reservation-conflict alert and propose reallocation; never silently substitute dietary-sensitive items.
- Partial fulfillment: consume only delivered lot quantities, release remainder or keep it until an explicit new expiry, and record reason.
- Correct completed pickup: reverse the original operation group and, if needed, post corrected fulfillment; never edit the completion history.

### Forecasts, expiration, and alerts

- Produce deterministic item and category forecasts from ledger usage, scheduled allocations, active reservations, confirmed incoming supply, expiry, operating days, and recorded overrides.
- Show on-hand, reserved, available, scheduled demand, baseline daily usage, incoming, expiring, shortage date, confidence, reasons, and suggested action.
- Expiration windows: expired, today, 3, 7, 14, and 30 days; actions are recommendations until a person confirms redistribution, quarantine, spoilage, or removal.
- Central alerts support informational/warning/urgent severity and open/acknowledged/in-progress/resolved/dismissed lifecycle with deduplication.

### SMS

- Track consent evidence, source, timestamp, status, language, phone normalization, opt-out, and history.
- Drafting sends nothing; scheduling creates a cancellable job; sending is an external side effect requiring permission and, for manual/bulk sends, confirmation.
- At send time exclude opted-out, no-consent, invalid, duplicate, cancelled, wrong-location, and otherwise ineligible recipients.
- Process Twilio delivery and inbound STOP/START/HELP/confirmation events with signature verification and idempotency.

### AI assistant

- Use allowlisted, typed server tools that return permission-filtered, minimized data.
- Read tools may answer; proposal tools create previews; high-impact tools execute only after a separate explicit confirmation request with fresh authorization and idempotency.
- Numerical responses include value, date range, location, calculation/source, data warning, and confidence where relevant.
- Responses label observed facts, calculated estimates, suggested actions, drafts, and confirmed actions distinctly.

### Reports

All reports use canonical ledger, appointment, SMS, and forecast views. Required reports are inventory on hand/by location/by category, transaction history, donations, distributions, shortages, donation needs, expirations, spoilage/waste, households served, pickup completion/no-show, SMS delivery, adjustments, user activity, and weekly operations.

Common filters are organization-authorized location, date/time range, category/item, storage, donor, transaction type, appointment status, message type, severity, and user as appropriate. CSV is required in version one; print/PDF is deferred unless a report has a clear operational need. Exports are asynchronous only when estimated rows exceed a configurable threshold, are access-controlled, expiring, and audited.

| Report                    | Canonical calculation/source                                     | Filters                                                       | Permission and performance                                                |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Inventory on hand         | Ledger balance view with expired/quarantine buckets              | as-of, location, item/category/storage/status                 | Inventory summary; indexed current view, historical replay async if large |
| Inventory by location     | Same balance view grouped by location                            | as-of, item/category, location set                            | Org report plus allowed locations; no cross-location leakage              |
| Inventory by category     | Item balances plus explicit category equivalents                 | as-of, location/category, mapped status                       | Forecast/report permission; shows unmapped coverage                       |
| Transaction history       | Immutable ledger entries/net by operation                        | date/effective date, location, item/lot/type/actor            | Inventory history; paginated and async export                             |
| Donation history          | Donations/lines linked to receipt groups                         | received/expected date, location, donor, item/category/status | Manager/admin; donor contact omitted from export by default               |
| Distribution history      | Physical outbound ledger types                                   | date, location, item/category, direct/pickup                  | Inventory/report permission; reversals shown/netted                       |
| Projected shortages       | Latest forecast snapshots                                        | as-of, horizon, location, item/category/confidence            | Forecast read; latest indexed snapshot                                    |
| Donation needs            | Shortage/reorder snapshots minus confirmed incoming              | horizon, location/category/urgency                            | Manager/admin; labels estimate and watermark                              |
| Expiring inventory        | Lot balance plus local expiration classification                 | date window, location/category/storage                        | Inventory read; FEFO index path                                           |
| Spoilage and waste        | Spoilage/damage/expiration outbound entries                      | date, location/category/reason                                | Manager/admin, limited worker summary; value optional                     |
| Households served         | Distinct completed appointment household per chosen period rule  | date, location/package                                        | Manager/admin/viewer aggregate; no names in summary                       |
| Pickup completion         | Appointment terminal/status history                              | date, location/window/package/status                          | Operations/report; aggregate for viewer                                   |
| No-show rate              | no-show / eligible scheduled appointments; denominator disclosed | date, location/window/package                                 | Operations/report; zero denominator handled                               |
| SMS delivery              | Recipient/event latest states and segment counts                 | date, location/template/message/mode/status                   | Manager/admin; no phones/body in aggregate                                |
| Inventory adjustments     | Manual adjustment/reversal entries and approvals                 | date, location/item/actor/reason/threshold                    | Manager/admin; paginated/audited export                                   |
| User activity             | Redacted audit events                                            | date, location/user/action/source                             | Admin/authorized manager; strict pagination/retention                     |
| Weekly operations summary | Versioned composition of the canonical reports above             | week, location set                                            | Manager/admin/viewer approved; generated snapshot links to sources        |

Dashboards call the same query functions/views with narrower limits. A report must disclose as-of time, local timezone, filters, numerator/denominator or ledger types, algorithm/version, and missing-data warnings.

### Page architecture

| Page                              | Primary users and purpose | Key data/actions                                                                | Filters, states, mobile, restrictions                                            |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Dashboard                         | All roles; today's work   | pickups, urgent alerts, shortages, expiring, incoming, reminders, recent ledger | Location/date; actionable empty states; stacked mobile cards; role-filtered      |
| Inventory / item detail           | Managers/workers/viewers  | available/on-hand/reserved, lots, FEFO, thresholds, history                     | Item/category/location/status/expiry; scanner-friendly mobile; no household data |
| Receive donation                  | Manager/worker            | donor, multi-line intake, lots, storage, value, commit preview                  | Draft recovery and validation; mobile line entry; atomic submit                  |
| Transactions                      | Manager/worker/viewer     | immutable ledger, operation groups, reversals                                   | Type/item/lot/user/date; correction permissions only                             |
| Reservations                      | Manager/worker            | conflicts, lot allocations, release/reallocate/fulfill                          | Appointment/item/status/date; no unnecessary household contact                   |
| Households / detail               | Admin/manager             | contact, consent, size/preferences, pickup history                              | Status/language/location; masked list view; no worker/export access              |
| Appointments / calendar           | Manager/worker/volunteer  | schedule, allocation, reminders, status actions                                 | Date/location/status; responsive agenda on mobile; minimized volunteer view      |
| Check-in                          | Volunteer/operations      | today's appointments, identifier, arrival/completion                            | Assigned location/window; large touch targets; restricted notes/contact          |
| Forecasts / expiring              | Manager/worker/viewer     | formula evidence, confidence, shortages, FEFO actions                           | Horizon/item/category/location/confidence; read-only by permission               |
| Alerts                            | Operations                | acknowledge, assign, resolve, dismiss                                           | Severity/type/status/location; resolution reason required                        |
| Messages / templates              | Admin/manager             | consent exclusions, drafts, schedule, delivery                                  | Type/status/date/language/location; send confirmation; worker draft-only         |
| Reports                           | Admin/manager/viewer      | canonical reports and exports                                                   | Report-specific; empty/partial-data explanations; export permission              |
| Audit log                         | Admin/manager             | actor/action/entity/source/request diff                                         | Location/user/action/date; redacted values; desktop-first                        |
| Users, roles, locations, settings | Admin                     | memberships, policy, integrations, retention                                    | Explicit save/confirmation; never exposed to other roles                         |
| AI assistant                      | Permissioned users        | scoped questions, sources, proposals, confirmations                             | Location/date context always visible; proposed actions are durable previews      |

Every page defines loading, empty, permission-denied, stale-data, validation, conflict, retryable provider, and unexpected-error states. Mobile prioritizes receiving, scanning, check-in, appointment actions, and alert triage; dense configuration and audit tables may use responsive detail drawers.

The dashboard's default actionable cards are available inventory, households served this week, pickups today, projected shortages, expiring soon, open urgent alerts, confirmed incoming donations/shipments, pending SMS reminders, and recent inventory activity. Each card displays location/as-of scope, links to the filtered source view, and is omitted or minimized when the role lacks access.

## Nonfunctional requirements

- **Correctness:** no negative available stock; every mutation is transactional, idempotent, and auditable.
- **Security/privacy:** default-deny RLS, minimized PII, TLS, provider encryption at rest, redacted logs, fake development data.
- **Availability:** core inventory and appointment reads remain usable when AI/Twilio are unavailable; queued messages resume safely.
- **Performance:** p95 authenticated page data under 1.5 seconds for demo-scale data; p95 command under 2 seconds excluding providers; indexed reports and pagination; background work for large exports.
- **Accessibility:** WCAG 2.2 AA target, keyboard navigation, clear focus, semantic labels, non-color status cues, reduced motion.
- **Observability:** request/job IDs, structured redacted logs, job/provider metrics, audit trails, and health checks.
- **Time:** store `timestamptz` in UTC; interpret operating days, appointment windows, and expiration dates in the location timezone. Expiration is a date-only field.
- **Recoverability:** managed backups plus tested restore procedure; append-only records retained according to policy.
- **Compatibility:** current evergreen browsers; responsive operations flows; no native application in version one.

## Version-one scope

Version one includes authentication; role and location access; multi-location-capable organization; item/lot/unit/storage management; immutable ledger; receiving, distribution, reservations, expiry, spoilage, damage, transfer, correction; minimized households; appointments/check-in/completion; deterministic forecasts and alerts; SMS consent, templates, reminder drafts, simulated/test sends and Twilio integration; safe AI reads and confirmed proposals; reports, audit logs, fictional demo data, onboarding, and deployment.

## Explicitly out of scope

Native mobile apps, automated purchasing, delivery routing, government eligibility verification, payments, advanced machine learning, facial recognition, identity documents, medical records, global multi-country compliance, many third-party integrations, autonomous AI writes, unrestricted custom roles, donor tax receipts, file attachments, and two-way conversational SMS beyond explicit keywords/confirmation are excluded.

## Success criteria

- A trained worker can receive a multi-line donation and trace every resulting lot and ledger entry.
- Concurrent reservations cannot oversell available stock in automated tests.
- A cancellation releases exactly its reservation; a completed pickup consumes it exactly once.
- Forecast cards reproduce documented calculations from the same ledger used by reports.
- Expired/quarantined lots never appear in distributable FEFO choices.
- Every role passes positive and negative permission tests across organization and location boundaries.
- No SMS send includes an ineligible recipient, and duplicate webhook delivery changes state once.
- No AI action writes without a durable preview, explicit confirmation, fresh authorization, audit, and idempotency.
- The portfolio demo completes receiving → appointment → reservation → reminder simulation → pickup → forecast/report with entirely fictional data.
