import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listDonors } from "@/domains/inventory/operations-queries";
import { listCategories, listItemsWithBalances } from "@/domains/inventory/queries";
import { isReportType, parseReportFilters, reportDefinitions, type ReportFilters, type ReportType } from "@/domains/reports/policy";
import { getAuthorizedReport, ReportError } from "@/domains/reports/service";
import { can, requireOrganizationContext } from "@/lib/auth/access";

type Search = Record<string, string | string[] | undefined>;

function searchFor(filters: ReportFilters, overrides: Record<string, string | number | undefined> = {}) {
  const values: Record<string, string | number | undefined> = { ...filters, ...overrides };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.toString();
}

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replaceAll("_", " ");
}

const statusOptions: Partial<Record<ReportType, { name: keyof ReportFilters; values: string[] }>> = {
  distributions: { name: "appointmentStatus", values: ["completed", "partially_completed", "no_show", "cancelled", "rescheduled"] },
  "pickup-schedule": { name: "appointmentStatus", values: ["scheduled", "confirmed", "arrived", "completed", "partially_completed", "no_show", "cancelled"] },
  "inventory-quality": { name: "transactionType", values: ["spoilage", "damage", "expiration_removal", "recall_disposal", "quarantine_placed", "quarantine_released"] },
  "inventory-transactions": { name: "transactionType", values: ["donation_received", "purchase_received", "pickup_fulfillment", "spoilage", "damage", "expiration", "manual_positive_adjustment", "manual_negative_adjustment", "transfer_in", "transfer_out", "reversal"] },
  forecasts: { name: "forecastConfidence", values: ["insufficient_data", "low", "medium", "high"] },
  messaging: { name: "messageStatus", values: ["scheduled", "queued", "accepted", "sent", "delivered", "undelivered", "failed", "cancelled", "excluded"] },
  transfers: { name: "transferStatus", values: ["draft", "requested", "approved", "dispatched", "partially_received", "received", "discrepancy_resolved", "cancelled"] },
  "transfer-manifest": { name: "transferStatus", values: ["draft", "requested", "approved", "dispatched", "partially_received", "received", "discrepancy_resolved", "cancelled"] },
};

export default async function ReportPage({ params, searchParams }: { params: Promise<{ organizationSlug: string; reportType: string }>; searchParams: Promise<Search> }) {
  const [{ organizationSlug, reportType: rawType }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isReportType(rawType)) notFound();
  const reportType = rawType;
  const context = await requireOrganizationContext(organizationSlug);
  if (!context.activeLocation || !can(context.effectivePermissions, "report.view") || !can(context.effectivePermissions, reportDefinitions[reportType].permission)) notFound();
  let filters: ReportFilters;
  try { filters = parseReportFilters(rawSearch, new Date(), reportType); } catch { notFound(); }
  let result;
  try {
    result = await getAuthorizedReport({ actorUserId: context.user.id, organizationSlug, locationId: context.activeLocation.id, reportType, filters });
  } catch (error) {
    if (error instanceof ReportError) notFound();
    throw error;
  }
  const [items, categories, donors] = await Promise.all([
    listItemsWithBalances(context.access.organization.id, context.activeLocation.id),
    listCategories(context.access.organization.id),
    can(context.effectivePermissions, "report.view_donations") ? listDonors(context.access.organization.id) : Promise.resolve([]),
  ]);
  const { data } = result;
  const filter = statusOptions[reportType];
  const supportsInventoryFilters = ["inventory-on-hand", "expiring-inventory", "inventory-quality", "inventory-transactions", "forecasts", "donation-needs", "inventory-count-sheet", "transfer-manifest"].includes(reportType);
  const query = searchFor(filters);
  const base = `/app/${organizationSlug}/reports/${reportType}`;
  const api = `/api/reports/${organizationSlug}/${reportType}?locationId=${context.activeLocation.id}&${query}`;
  const print = `/app/${organizationSlug}/reports/print/${reportType}?${query}`;

  return <div className="grid gap-8">
    <PageHeader eyebrow="Reports" title={`${data.title} · ${result.scope.locationName}`} description={data.description} actions={<div className="flex flex-wrap gap-2">
      <Link className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold" href={`/app/${organizationSlug}/reports`}>All reports</Link>
      {can(context.effectivePermissions, "report.export") ? <a className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold" href={api}>Export CSV</a> : null}
      {data.reportType && reportDefinitions[reportType].printable && can(context.effectivePermissions, "report.print") ? <Link className="inline-flex min-h-11 items-center border border-[var(--signal)] bg-[var(--signal)] px-4 text-sm font-semibold text-white" href={print}>Print view</Link> : null}
    </div>} />
    <form method="get" className="grid gap-4 border border-[var(--rule)] bg-white p-5 md:grid-cols-2 xl:grid-cols-5">
      <label className="grid gap-1 text-sm font-semibold">From<input className="min-h-11 border border-[var(--rule)] px-3 font-normal" type="date" name="dateFrom" defaultValue={filters.dateFrom} required /></label>
      <label className="grid gap-1 text-sm font-semibold">To<input className="min-h-11 border border-[var(--rule)] px-3 font-normal" type="date" name="dateTo" defaultValue={filters.dateTo} required /></label>
      {supportsInventoryFilters ? <label className="grid gap-1 text-sm font-semibold">Item<select className="min-h-11 border border-[var(--rule)] px-3 font-normal" name="itemId" defaultValue={filters.itemId ?? ""}><option value="">All items</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
      {supportsInventoryFilters ? <label className="grid gap-1 text-sm font-semibold">Category<select className="min-h-11 border border-[var(--rule)] px-3 font-normal" name="categoryId" defaultValue={filters.categoryId ?? ""}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label> : null}
      {donors.length > 0 && ["donations", "donor-contributions"].includes(reportType) ? <label className="grid gap-1 text-sm font-semibold">Donor<select className="min-h-11 border border-[var(--rule)] px-3 font-normal" name="donorId" defaultValue={filters.donorId ?? ""}><option value="">All donors</option>{donors.map((donor) => <option key={donor.id} value={donor.id}>{donor.name}</option>)}</select></label> : null}
      {filter ? <label className="grid gap-1 text-sm font-semibold">Status or type<select className="min-h-11 border border-[var(--rule)] px-3 font-normal" name={filter.name} defaultValue={String(filters[filter.name] ?? "")}><option value="">All</option>{filter.values.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label> : null}
      <div className="flex items-end gap-3"><button className="min-h-11 border border-[var(--ink)] bg-[var(--ink)] px-4 text-sm font-semibold text-white" type="submit">Apply filters</button><Link className="inline-flex min-h-11 items-center text-sm font-semibold underline" href={base}>Reset</Link></div>
    </form>
    <p className="text-sm text-[var(--muted)]">{data.dateFrom} through {data.dateTo} · generated {new Date(data.generatedAt).toLocaleString()} · page {data.page}</p>
    {data.rows.length === 0 ? <EmptyState title="No report rows" description="No canonical records match this location, date range, and filter combination." /> : <div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">{data.columns.map((column) => <th key={column.key} className={`p-3 font-semibold ${column.numeric ? "text-right" : ""}`}>{column.label}</th>)}</tr></thead><tbody>{data.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-[var(--rule)] last:border-0">{data.columns.map((column) => <td key={column.key} className={`p-3 align-top ${column.numeric ? "text-right tabular-nums" : ""}`}>{valueText(row[column.key])}</td>)}</tr>)}</tbody></table></div>}
    <div className="flex justify-between text-sm font-semibold">{filters.page > 1 ? <Link className="underline" href={`${base}?${searchFor(filters, { page: filters.page - 1 })}`}>← Previous</Link> : <span />}{data.hasNext ? <Link className="underline" href={`${base}?${searchFor(filters, { page: filters.page + 1 })}`}>Next →</Link> : <span />}</div>
  </div>;
}
