import { z } from "zod";

export const reportTypes = [
  "inventory-on-hand",
  "expiring-inventory",
  "inventory-quality",
  "inventory-transactions",
  "donations",
  "donor-contributions",
  "receiving",
  "distributions",
  "pickup-schedule",
  "forecasts",
  "messaging",
  "weekly-summary",
  "donation-needs",
  "inventory-count-sheet",
  "transfer-manifest",
  "transfers",
  "alerts",
] as const;

export type ReportType = (typeof reportTypes)[number];
export type ReportPermission =
  | "report.view_inventory"
  | "report.view_donations"
  | "report.view_distributions"
  | "report.view_forecast"
  | "report.view_messaging"
  | "report.weekly_summary";

export type ReportColumn = { key: string; label: string; numeric?: boolean };
export type ReportDefinition = {
  title: string;
  description: string;
  permission: ReportPermission;
  printable: boolean;
  columns: readonly ReportColumn[];
};

export const reportDefinitions: Record<ReportType, ReportDefinition> = {
  "inventory-on-hand": {
    title: "Inventory on hand",
    description: "Physical, valid, reserved, and available inventory from canonical balance views.",
    permission: "report.view_inventory",
    printable: false,
    columns: [
      { key: "category", label: "Category" }, { key: "item", label: "Item" }, { key: "sku", label: "SKU" },
      { key: "physical_on_hand", label: "Physical", numeric: true }, { key: "valid_on_hand", label: "Valid", numeric: true },
      { key: "reserved_quantity", label: "Reserved", numeric: true }, { key: "available_quantity", label: "Available", numeric: true },
      { key: "quarantined_quantity", label: "Quarantined", numeric: true }, { key: "recalled_quantity", label: "Recalled", numeric: true },
      { key: "expired_quantity", label: "Expired", numeric: true }, { key: "unit", label: "Unit" },
    ],
  },
  "expiring-inventory": {
    title: "Expiring inventory",
    description: "Positive lot balances ordered by expiration date, including expired and held quantities.",
    permission: "report.view_inventory",
    printable: true,
    columns: [
      { key: "item", label: "Item" }, { key: "lot", label: "Lot" }, { key: "storage", label: "Storage" },
      { key: "expiration_date", label: "Expiration" }, { key: "days_remaining", label: "Days remaining", numeric: true },
      { key: "physical_on_hand", label: "On hand", numeric: true }, { key: "available_quantity", label: "Available", numeric: true },
      { key: "unit", label: "Unit" }, { key: "condition", label: "Condition" },
    ],
  },
  "inventory-quality": {
    title: "Inventory quality",
    description: "Spoilage, damage, expiration removal, recall disposal, and hold activity.",
    permission: "report.view_inventory",
    printable: false,
    columns: [
      { key: "event_date", label: "Date" }, { key: "event_type", label: "Event" }, { key: "item", label: "Item" },
      { key: "lot", label: "Lot" }, { key: "quantity", label: "Quantity", numeric: true }, { key: "unit", label: "Unit" },
      { key: "reason", label: "Reason" },
    ],
  },
  "inventory-transactions": {
    title: "Inventory transaction history",
    description: "Immutable ledger activity, including reversals and corrections.",
    permission: "report.view_inventory",
    printable: false,
    columns: [
      { key: "occurred_at", label: "Occurred" }, { key: "item", label: "Item" }, { key: "lot", label: "Lot" },
      { key: "transaction_type", label: "Type" }, { key: "physical_delta", label: "Delta", numeric: true },
      { key: "unit", label: "Unit" }, { key: "reason", label: "Reason" },
    ],
  },
  donations: {
    title: "Donation history",
    description: "Donation records and quantities received through completed receiving lines.",
    permission: "report.view_donations",
    printable: false,
    columns: [
      { key: "donation_date", label: "Date" }, { key: "donation_number", label: "Donation" }, { key: "donor", label: "Donor" },
      { key: "status", label: "Status" }, { key: "line_count", label: "Lines", numeric: true },
      { key: "received_quantity", label: "Received base quantity", numeric: true }, { key: "estimated_value", label: "Estimated value", numeric: true },
    ],
  },
  "donor-contributions": {
    title: "Donor contribution summary",
    description: "Contribution counts, received base quantities, and declared estimated values by donor.",
    permission: "report.view_donations",
    printable: true,
    columns: [
      { key: "donor", label: "Donor" }, { key: "donor_type", label: "Type" }, { key: "donation_count", label: "Donations", numeric: true },
      { key: "completed_donations", label: "Completed", numeric: true }, { key: "received_quantity", label: "Received base quantity", numeric: true },
      { key: "estimated_value", label: "Estimated value", numeric: true }, { key: "last_donation_date", label: "Last donation" },
    ],
  },
  receiving: {
    title: "Receiving activity",
    description: "Donation, purchase, and other receiving sessions with posted quantities.",
    permission: "report.view_donations",
    printable: false,
    columns: [
      { key: "started_at", label: "Started" }, { key: "source_type", label: "Source" }, { key: "reference", label: "Reference" },
      { key: "status", label: "Status" }, { key: "line_count", label: "Lines", numeric: true },
      { key: "received_quantity", label: "Received base quantity", numeric: true }, { key: "completed_at", label: "Completed" },
    ],
  },
  distributions: {
    title: "Distribution and household service",
    description: "Completed, partial, cancelled, and missed pickups without household contact details.",
    permission: "report.view_distributions",
    printable: false,
    columns: [
      { key: "service_date", label: "Service date" }, { key: "appointment_number", label: "Appointment" },
      { key: "household_number", label: "Household" }, { key: "household_size", label: "Household size", numeric: true },
      { key: "status", label: "Status" }, { key: "package", label: "Package" },
      { key: "item_lines", label: "Item lines", numeric: true }, { key: "distributed_quantity", label: "Distributed base quantity", numeric: true },
    ],
  },
  "pickup-schedule": {
    title: "Pickup schedule",
    description: "A public-minimized appointment schedule with household numbers instead of names or contacts.",
    permission: "report.view_distributions",
    printable: true,
    columns: [
      { key: "scheduled_start", label: "Start" }, { key: "scheduled_end", label: "End" }, { key: "appointment_number", label: "Appointment" },
      { key: "household_number", label: "Household" }, { key: "household_size", label: "Size", numeric: true },
      { key: "appointment_type", label: "Type" }, { key: "package", label: "Package" },
      { key: "reservation_status", label: "Reservation" }, { key: "status", label: "Status" },
    ],
  },
  forecasts: {
    title: "Forecast and shortage report",
    description: "Latest deterministic item forecast snapshot for the selected location.",
    permission: "report.view_forecast",
    printable: false,
    columns: [
      { key: "generated_at", label: "Generated" }, { key: "category", label: "Category" }, { key: "item", label: "Item" },
      { key: "available_quantity", label: "Available", numeric: true }, { key: "daily_demand", label: "Daily demand", numeric: true },
      { key: "confirmed_incoming", label: "Incoming", numeric: true }, { key: "shortage_date", label: "Shortage date" },
      { key: "recommended_quantity", label: "Recommended", numeric: true }, { key: "unit", label: "Unit" },
      { key: "confidence", label: "Confidence" }, { key: "risk", label: "Risk" },
    ],
  },
  messaging: {
    title: "Messaging performance",
    description: "Daily outbound delivery, failure, opt-out, and appointment-confirmation aggregates.",
    permission: "report.view_messaging",
    printable: false,
    columns: [
      { key: "day", label: "Day" }, { key: "messages_sent", label: "Sent", numeric: true },
      { key: "delivered", label: "Delivered", numeric: true }, { key: "failed", label: "Failed", numeric: true },
      { key: "delivery_rate", label: "Delivery rate" }, { key: "opt_outs", label: "Opt-outs", numeric: true },
      { key: "confirmations", label: "Confirmations", numeric: true },
    ],
  },
  "weekly-summary": {
    title: "Weekly operations summary",
    description: "Deterministic operational metrics calculated from canonical transactions and state history.",
    permission: "report.weekly_summary",
    printable: true,
    columns: [
      { key: "metric", label: "Metric" }, { key: "value", label: "Value" }, { key: "unit", label: "Unit" }, { key: "note", label: "Interpretation" },
    ],
  },
  "donation-needs": {
    title: "Donation needs",
    description: "Human-review recommendations from the latest deterministic forecast snapshot.",
    permission: "report.view_forecast",
    printable: true,
    columns: [
      { key: "priority", label: "Priority" }, { key: "item", label: "Item or category" },
      { key: "available_supply", label: "Available", numeric: true }, { key: "projected_demand", label: "Projected demand", numeric: true },
      { key: "confirmed_incoming", label: "Incoming", numeric: true }, { key: "shortage_date", label: "Shortage date" },
      { key: "needed_by", label: "Needed by" }, { key: "recommended_amount", label: "Recommended", numeric: true },
      { key: "unit", label: "Unit" }, { key: "confidence", label: "Confidence" }, { key: "explanation", label: "Explanation" },
    ],
  },
  "inventory-count-sheet": {
    title: "Inventory count sheet",
    description: "Printable lot list with blank physical-count and note columns.",
    permission: "report.view_inventory",
    printable: true,
    columns: [
      { key: "item", label: "Item" }, { key: "lot", label: "Lot" }, { key: "storage", label: "Storage" },
      { key: "expiration_date", label: "Expiration" }, { key: "expected_quantity", label: "Expected", numeric: true },
      { key: "unit", label: "Unit" }, { key: "physical_count", label: "Physical count" }, { key: "notes", label: "Notes" },
    ],
  },
  "transfer-manifest": {
    title: "Transfer manifest",
    description: "Transfer lines touching the selected location for handoff and receiving review.",
    permission: "report.view_inventory",
    printable: true,
    columns: [
      { key: "transfer_number", label: "Transfer" }, { key: "status", label: "Status" }, { key: "source", label: "Source" },
      { key: "destination", label: "Destination" }, { key: "item", label: "Item" }, { key: "lot", label: "Lot" },
      { key: "requested", label: "Requested", numeric: true }, { key: "dispatched", label: "Dispatched", numeric: true },
      { key: "received", label: "Received", numeric: true }, { key: "in_transit", label: "In transit", numeric: true }, { key: "unit", label: "Unit" },
    ],
  },
  transfers: {
    title: "Transfer activity",
    description: "Transfer status and in-transit quantities for the selected location.",
    permission: "report.view_inventory",
    printable: false,
    columns: [
      { key: "created_at", label: "Created" }, { key: "transfer_number", label: "Transfer" }, { key: "source", label: "Source" },
      { key: "destination", label: "Destination" }, { key: "status", label: "Status" }, { key: "line_count", label: "Lines", numeric: true },
      { key: "in_transit", label: "In transit base quantity", numeric: true },
    ],
  },
  alerts: {
    title: "Operational alerts",
    description: "Alerts opened, acknowledged, dismissed, and resolved in the selected period.",
    permission: "report.view_forecast",
    printable: false,
    columns: [
      { key: "last_detected_at", label: "Last detected" }, { key: "alert_type", label: "Type" }, { key: "severity", label: "Severity" },
      { key: "status", label: "Status" }, { key: "title", label: "Title" }, { key: "occurrences", label: "Occurrences", numeric: true },
      { key: "resolved_at", label: "Resolved" },
    ],
  },
};

const optionalUuid = z.preprocess((value) => value === "" ? undefined : value, z.string().uuid().optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalFilter = z.string().trim().max(80).optional().transform((value) => value || undefined);

export const reportFilterSchema = z.object({
  dateFrom: date.optional(),
  dateTo: date.optional(),
  range: z.enum(["current-week", "previous-week", "custom", "last-30-days"]).optional(),
  itemId: optionalUuid,
  categoryId: optionalUuid,
  donorId: optionalUuid,
  householdId: optionalUuid,
  appointmentStatus: optionalFilter,
  transactionType: optionalFilter,
  alertType: optionalFilter,
  messageStatus: optionalFilter,
  forecastConfidence: optionalFilter,
  transferStatus: optionalFilter,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export type ReportFilters = z.infer<typeof reportFilterSchema> & { dateFrom: string; dateTo: string };

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function defaultDateRange(now = new Date(), range: "current-week" | "previous-week" | "last-30-days" = "last-30-days") {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "last-30-days") return { dateFrom: isoDate(addUtcDays(today, -29)), dateTo: isoDate(today) };
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const currentMonday = addUtcDays(today, -mondayOffset);
  const start = range === "previous-week" ? addUtcDays(currentMonday, -7) : currentMonday;
  return { dateFrom: isoDate(start), dateTo: isoDate(addUtcDays(start, 6)) };
}

export function parseReportFilters(input: Record<string, string | string[] | undefined>, now = new Date(), reportType?: ReportType): ReportFilters {
  const flattened = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = reportFilterSchema.parse(flattened);
  const range = parsed.range ?? (reportType === "weekly-summary" ? "current-week" : "last-30-days");
  const defaults = defaultDateRange(now, range === "custom" ? "last-30-days" : range);
  const dateFrom = parsed.dateFrom ?? defaults.dateFrom;
  const dateTo = parsed.dateTo ?? defaults.dateTo;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from > to) throw new Error("INVALID_DATE_RANGE");
  const inclusiveDays = Math.floor((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
  if (inclusiveDays > 366) throw new Error("DATE_RANGE_TOO_LARGE");
  return { ...parsed, dateFrom, dateTo };
}

export function isReportType(value: string): value is ReportType {
  return (reportTypes as readonly string[]).includes(value);
}

export function spreadsheetSafeValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value: unknown) {
  const safe = spreadsheetSafeValue(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function createCsv(columns: readonly ReportColumn[], rows: readonly Record<string, unknown>[]) {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column.key])).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function weeklyRecommendations(metrics: { urgentAlerts: number; noShows: number; failedMessages: number; expiringQuantity: number }) {
  const recommendations: string[] = [];
  if (metrics.urgentAlerts > 0) recommendations.push("Review and assign every open urgent alert.");
  if (metrics.expiringQuantity > 0) recommendations.push("Prioritize expiring inventory in upcoming distributions.");
  if (metrics.noShows > 0) recommendations.push("Review missed pickups before the next scheduling cycle.");
  if (metrics.failedMessages > 0) recommendations.push("Review failed messages and invalid recipient numbers.");
  if (recommendations.length === 0) recommendations.push("Continue normal operating review; no rule-based exception was detected.");
  return recommendations;
}
