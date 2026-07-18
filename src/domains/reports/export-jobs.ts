import "server-only";

import { sql } from "drizzle-orm";
import { createCsv, type ReportFilters, type ReportType } from "@/domains/reports/policy";
import { loadReport } from "@/domains/reports/queries";
import { db } from "@/lib/database/client";

export async function processReportExportJobs(limit = 5) {
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 20); index += 1) {
    const claimed = await db.execute<{ id: string; organization_id: string; pantry_location_id: string | null; report_type: ReportType; date_from: string; date_to: string; filters: ReportFilters }>(sql`
      update report_export_jobs
         set status='processing', started_at=now()
       where id=(select id from report_export_jobs where status='queued' order by created_at for update skip locked limit 1)
       returning id,organization_id,pantry_location_id,report_type,date_from::text,date_to::text,filters
    `);
    const job = claimed.rows[0];
    if (!job) break;
    try {
      if (!job.pantry_location_id) throw new Error("EXPORT_LOCATION_REQUIRED");
      const scope = await db.execute<{ timezone: string }>(sql`select coalesce(pl.timezone,o.timezone,'UTC') timezone from pantry_locations pl join organizations o on o.id=pl.organization_id where pl.id=${job.pantry_location_id}::uuid and pl.organization_id=${job.organization_id}::uuid limit 1`);
      if (!scope.rows[0]) throw new Error("EXPORT_SCOPE_NOT_FOUND");
      const data = await loadReport({ organizationId: job.organization_id, locationId: job.pantry_location_id, timezone: scope.rows[0].timezone }, job.report_type, { ...job.filters, dateFrom: job.date_from, dateTo: job.date_to }, { maxRows: 100_000, offset: 0 });
      const csv = createCsv(data.columns, data.rows);
      await db.execute(sql`update report_export_jobs set status='completed',row_count=${data.rows.length},result_text=${csv},completed_at=now() where id=${job.id}`);
      completed += 1;
    } catch (error) {
      await db.execute(sql`update report_export_jobs set status='failed',error_summary=${error instanceof Error ? error.message : "EXPORT_FAILED"},completed_at=now() where id=${job.id}`);
      failed += 1;
    }
  }
  return { completed, failed };
}
