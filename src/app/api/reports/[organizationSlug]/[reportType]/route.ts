import { z } from "zod";
import { createCsv, isReportType, parseReportFilters } from "@/domains/reports/policy";
import { getAuthorizedReport, recordReportExport, ReportError } from "@/domains/reports/service";
import { getCurrentUser } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ organizationSlug: string; reportType: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { organizationSlug, reportType } = await params;
  if (!isReportType(reportType)) return Response.json({ error: "Report not found." }, { status: 404 });
  const url = new URL(request.url);
  const location = z.string().uuid().safeParse(url.searchParams.get("locationId"));
  if (!location.success) return Response.json({ error: "A valid pantry location is required." }, { status: 400 });
  let filters;
  try { filters = parseReportFilters(Object.fromEntries(url.searchParams), new Date(), reportType); }
  catch { return Response.json({ error: "The report filters are invalid." }, { status: 400 }); }
  try {
    const result = await getAuthorizedReport({ actorUserId: currentUser.id, organizationSlug, locationId: location.data, reportType, filters, mode: "export" });
    const requestId = crypto.randomUUID();
    await recordReportExport({ actorUserId: currentUser.id, scope: result.scope, reportType, filters, rowCount: result.data.rows.length, requestId });
    const csv = createCsv(result.data.columns, result.data.rows);
    const filename = `${reportType}-${filters.dateFrom}-${filters.dateTo}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof ReportError) {
      if (error.code === "REPORT_TOO_LARGE") return Response.json({ error: "Narrow the date range; exports are limited to 5,000 rows." }, { status: 413 });
      return Response.json({ error: error.code === "FORBIDDEN" ? "You do not have permission to export this report." : "Report not found." }, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    }
    console.error("Report export failed", { reportType, organizationSlug, error: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "The report could not be exported." }, { status: 500 });
  }
}

