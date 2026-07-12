import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { isReportType, parseReportFilters, reportDefinitions, type ReportColumn, type ReportFilters } from "@/domains/reports/policy";
import { getAuthorizedReport, ReportError } from "@/domains/reports/service";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { PrintButton } from "../print-button";

type Search = Record<string, string | string[] | undefined>;

export default async function PrintableReportPage({ params, searchParams }: { params: Promise<{ organizationSlug: string; reportType: string }>; searchParams: Promise<Search> }) {
  const [{ organizationSlug, reportType: rawType }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isReportType(rawType) || !reportDefinitions[rawType].printable) notFound();
  const context = await requireOrganizationContext(organizationSlug);
  if (!context.activeLocation || !can(context.effectivePermissions, "report.view") || !can(context.effectivePermissions, "report.print")) notFound();
  let filters: ReportFilters;
  try { filters = parseReportFilters(rawSearch, new Date(), rawType); } catch { notFound(); }
  let result;
  try { result = await getAuthorizedReport({ actorUserId: context.user.id, organizationSlug, locationId: context.activeLocation.id, reportType: rawType, filters, mode: "print" }); }
  catch (error) { if (error instanceof ReportError) notFound(); throw error; }
  const publicDonationKeys = new Set(["priority", "item", "needed_by", "recommended_amount", "unit"]);
  const columns = (rawType === "donation-needs" ? result.data.columns.filter((column) => publicDonationKeys.has(column.key)) : result.data.columns) as readonly ReportColumn[];

  return <div className="report-page grid gap-6 bg-white text-black">
    <style>{`@media print { nav, aside, .report-no-print { display:none !important; } body { background:white !important; } main { padding:0 !important; max-width:none !important; } .report-page { display:block !important; } .report-page table { page-break-inside:auto; } .report-page tr { page-break-inside:avoid; page-break-after:auto; } .report-page thead { display:table-header-group; } } @page { margin:0.55in; }`}</style>
    <div className="report-no-print flex flex-wrap justify-between gap-3"><Link className="text-sm font-semibold underline" href={`/app/${organizationSlug}/reports/${rawType}`}>← Back to report</Link><PrintButton /></div>
    <header className="border-b-2 border-black pb-4"><p className="text-sm font-semibold uppercase tracking-widest">{result.scope.organizationName}</p><h1 className="mt-2 text-3xl font-bold">{result.data.title}</h1><p className="mt-2">{result.scope.locationName} · {result.data.dateFrom} through {result.data.dateTo}</p><p className="mt-1 text-sm">Generated {new Date(result.data.generatedAt).toLocaleString("en-US", { timeZone: result.scope.timezone })}</p>{rawType === "donation-needs" ? <p className="mt-2 text-sm">Public-safe operational request. Internal inventory, demand, and confidence details are intentionally omitted.</p> : null}</header>
    {result.data.rows.length === 0 ? <EmptyState title="No report rows" description="No records matched the selected date range." /> : <table className="w-full border-collapse text-sm"><thead><tr>{columns.map((column) => <th key={column.key} className={`border-b-2 border-black p-2 text-left ${column.numeric ? "text-right" : ""}`}>{column.label}</th>)}</tr></thead><tbody>{result.data.rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key} className={`border-b border-neutral-300 p-2 align-top ${column.numeric ? "text-right tabular-nums" : ""}`}>{row[column.key] === null || row[column.key] === undefined || row[column.key] === "" ? "—" : String(row[column.key]).replaceAll("_", " ")}</td>)}</tr>)}</tbody></table>}
    {result.data.hasNext ? <p className="font-semibold">This print view reached its 2,000-row safety limit. Narrow the date range before printing the complete report.</p> : null}
    <footer className="border-t border-black pt-3 text-xs">Generated from canonical Food Pantry Inventory + SMS Assistant records. No contact details are included.</footer>
  </div>;
}

