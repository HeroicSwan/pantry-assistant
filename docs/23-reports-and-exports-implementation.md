# Reports and exports implementation

## Scope

Prompt 7 adds server-rendered operational reports, bounded CSV exports, and print-friendly HTML to the native Windows PostgreSQL application. Reports never query PostgreSQL from the browser. No Docker, Supabase, hosted database, PDF library, or AI calculation path is required.

## Report catalog

The Reports area contains these real, location-scoped views:

- Inventory on hand: physical, valid, reserved, available, quarantined, recalled, and expired quantities.
- Expiring inventory: positive lot balances ordered by expiration, with storage and condition state.
- Inventory quality: spoilage, damage, expiration removal, recall disposal, quarantine, and release events.
- Inventory transaction history: immutable ledger activity, including reversals.
- Donation history: donor, donation state, declared value, and quantities posted through completed receiving lines.
- Donor contribution summary: donation counts, completed counts, posted base quantities, values, and last contribution dates.
- Receiving activity: completed and in-progress receiving sessions with posted quantities.
- Distribution and household service: appointment outcomes and fulfillment quantities with household numbers, not names or contacts.
- Pickup schedule: appointment time, household number, package, reservation state, and status.
- Forecast report: latest successful deterministic item forecast.
- Messaging performance: sent, delivered, failed, opt-out, and confirmation aggregates when messaging records exist.
- Weekly operations summary: deterministic cross-domain metrics and rule-based recommended actions.
- Donation needs: latest Prompt 6 recommendations with the forecast facts behind them.
- Inventory count sheet: print-oriented lot listing with blank count and notes columns.
- Transfer manifest and transfer activity: source, destination, item, lot, and in-transit state.
- Operational alerts: alert type, severity, lifecycle state, occurrence count, and resolution date.

## Canonical metric definitions

Reports reuse canonical database facts rather than maintaining independent counters:

- Inventory quantities come from `inventory_lot_balances` and `inventory_item_location_balances`. Available quantity therefore already excludes invalid stock and active reservations.
- Receiving quantity comes from completed `receiving_lines.normalized_base_quantity` records.
- Distribution quantity comes from completed, non-corrected pickup fulfillment lines. The weekly distributed total uses the immutable inventory ledger and includes pickup reversals.
- Quality totals come from immutable ledger transaction types and condition events.
- Forecast rows come from the latest completed `forecast_snapshots` record and its immutable item results.
- Donation needs come from the latest immutable `donation_need_snapshots` record and are enriched from the associated forecast snapshot.
- Message delivery metrics use final `sms_messages` states. Opt-outs and confirmations use normalized inbound commands.
- Weekly summary values are SQL-derived. Rule-based recommendations are deterministic and do not call AI.

Quantities are labeled as base units when a report combines different inventory items. Item and lot reports include the exact base-unit abbreviation.

## Filters and query bounds

Every report is organization and pantry-location scoped. Date filters are inclusive local calendar dates, interpreted with the pantry location timezone and falling back to the organization timezone. The default report range is the latest 30 calendar days. The weekly report defaults to Monday through Sunday of the current week; previous-week and custom ranges are also supported by the filter parser.

Supported server-side filter values include item, category, donor, household, appointment status, transaction type, alert type, message status, forecast confidence, and transfer status. Household filtering requires `household.view_sensitive`. The standard page size is 50 and cannot exceed 200. Date ranges cannot exceed 366 days.

Interactive results use bounded pagination. CSV exports stop and request a narrower range when more than 5,000 rows match. Print views stop at 2,000 rows and visibly state that the range must be narrowed.

## Permissions and isolation

All report reads require `report.view` plus one category permission:

- `report.view_inventory`
- `report.view_donations`
- `report.view_distributions`
- `report.view_forecast`
- `report.view_messaging`
- `report.weekly_summary`

CSV additionally requires `report.export`. Print routes additionally require `report.print`. The server independently resolves an active organization, active or temporarily closed location, active organization membership, non-expired role assignment, and effective location permission. Knowing an organization slug, location UUID, or report URL does not bypass authorization.

Household contacts, household names, phone numbers, email addresses, notes, message bodies, and donor contact fields are not report columns. Distribution and schedule reports use the household number. The donor summary includes donor display name but omits all contact fields.

## CSV exports

CSV files are generated by an authenticated API route and use:

- Stable column headers defined by the report catalog.
- UTF-8 with a byte-order marker for spreadsheet compatibility.
- CRLF record delimiters.
- RFC-style quoting for commas, quotes, and line breaks.
- Spreadsheet formula-injection protection for values whose first effective character is `=`, `+`, `-`, or `@`.
- `no-store` and `nosniff` response headers.
- A required, validated pantry location and bounded date range.

Before returning a file, the server appends a `report_exports` record containing actor, report type, filters, row count, organization, location, request ID, and timestamp. It also appends a matching `report.exported` audit record. The database prevents updates and deletes of export records.

## Print views

Print-friendly HTML is available for:

- Donation needs
- Weekly operations summary
- Expiring inventory
- Pickup schedule
- Inventory count sheet
- Transfer manifest
- Donor contribution summary

The print layout includes organization, location, date range, generated timestamp, repeated table headers, page-break protection, and no interactive controls in printed output. Browser print-to-PDF is used rather than adding a PDF dependency. Donation-needs print output is public-safe: it omits internal available-supply, projected-demand, incoming-supply, confidence, and calculation-explanation columns.

## Testing

`src/domains/reports/reports-policy.test.ts` verifies:

- Current-week, previous-week, and rolling date ranges.
- Rejection of inverted and overlong ranges.
- CSV quoting.
- Formula-injection prevention, including whitespace-prefixed formulas.
- Report-to-permission mapping.
- Deterministic weekly recommendations.

`tests/integration/reports.test.ts` verifies:

- Every report query against native PostgreSQL.
- Organization and location scope.
- Cross-organization denial when UUIDs are known.
- Export audit creation.
- Database-enforced append-only export records.

`tests/e2e/reports.spec.ts` covers the administrator filter/export/print journey and blocks another organization's administrator from both report pages and the direct CSV endpoint.

Normal validation commands remain `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, and `pnpm build`.

## Limitations

- Reports are operational tables and summaries, not a free-form report designer.
- Interactive CSV exports are capped at 5,000 rows per request; larger datasets can be queued with `queueLargeReportExport` and processed by `pnpm reports:exports` into the local `report_export_jobs` store.
- Print views use browser printing and do not produce server-generated PDF files.
- Messaging reports are empty until SMS messages or inbound commands exist.
- Combined quantities across different items are explicitly labeled as base units and should not be interpreted as equivalent food value, weight, or service units.
- Household contact exports are deliberately absent. A future privacy-reviewed export would require a dedicated permission, explicit columns, and retention guidance.
