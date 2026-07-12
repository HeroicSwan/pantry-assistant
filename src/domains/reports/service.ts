import "server-only";

import { sql } from "drizzle-orm";
import { reportDefinitions, type ReportFilters, type ReportType } from "@/domains/reports/policy";
import { loadReport, type ReportData, type ReportScope } from "@/domains/reports/queries";
import { db } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";

export type ReportMode = "view" | "print" | "export";

export class ReportError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "REPORT_TOO_LARGE") {
    super(code);
    this.name = "ReportError";
  }
}

type ResolvedScope = ReportScope & { organizationName: string; organizationSlug: string; locationName: string };

async function resolveScope(organizationSlug: string, locationId: string): Promise<ResolvedScope> {
  const [scope] = await db.execute<ResolvedScope>(sql`
    select o.id as "organizationId", pl.id as "locationId", coalesce(pl.timezone,o.timezone,'UTC') as timezone,
      o.name as "organizationName", o.slug as "organizationSlug", pl.name as "locationName"
    from organizations o join pantry_locations pl on pl.organization_id=o.id
    where o.slug=${organizationSlug} and o.status='active' and pl.id=${locationId}::uuid and pl.status <> 'archived'
    limit 1
  `).then((result) => result.rows);
  if (!scope) throw new ReportError("NOT_FOUND");
  return scope;
}

async function requirePermission(actorUserId: string, scope: ResolvedScope, permission: string) {
  if (!(await hasLocationPermission(db, actorUserId, scope.locationId, permission))) throw new ReportError("FORBIDDEN");
}

export async function getAuthorizedReport(input: {
  actorUserId: string;
  organizationSlug: string;
  locationId: string;
  reportType: ReportType;
  filters: ReportFilters;
  mode?: ReportMode;
}) {
  const mode = input.mode ?? "view";
  const scope = await resolveScope(input.organizationSlug, input.locationId);
  const definition = reportDefinitions[input.reportType];
  await requirePermission(input.actorUserId, scope, "report.view");
  await requirePermission(input.actorUserId, scope, definition.permission);
  if (mode === "export") await requirePermission(input.actorUserId, scope, "report.export");
  if (mode === "print") {
    if (!definition.printable) throw new ReportError("NOT_FOUND");
    await requirePermission(input.actorUserId, scope, "report.print");
  }
  if (input.filters.householdId) await requirePermission(input.actorUserId, scope, "household.view_sensitive");

  const data = await loadReport(scope, input.reportType, input.filters, mode === "export" ? { maxRows: 5_000, offset: 0 } : mode === "print" ? { maxRows: 2_000, offset: 0 } : undefined);
  if (mode === "export" && data.hasNext) throw new ReportError("REPORT_TOO_LARGE");
  return { scope, data };
}

function auditFilters(filters: ReportFilters) {
  return {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    itemId: filters.itemId,
    categoryId: filters.categoryId,
    donorId: filters.donorId,
    householdId: filters.householdId,
    appointmentStatus: filters.appointmentStatus,
    transactionType: filters.transactionType,
    alertType: filters.alertType,
    messageStatus: filters.messageStatus,
    forecastConfidence: filters.forecastConfidence,
    transferStatus: filters.transferStatus,
  };
}

export async function recordReportExport(input: {
  actorUserId: string;
  scope: ResolvedScope;
  reportType: ReportType;
  filters: ReportFilters;
  rowCount: number;
  requestId: string;
}) {
  return db.transaction(async (tx) => {
    const [membership] = await tx.execute<{ id: string }>(sql`
      select id from organization_memberships
      where organization_id=${input.scope.organizationId}::uuid and user_id=${input.actorUserId}::uuid
        and status='active' and archived_at is null limit 1
    `).then((result) => result.rows);
    if (!membership) throw new ReportError("FORBIDDEN");
    const filters = auditFilters(input.filters);
    const [created] = await tx.execute<{ id: string }>(sql`
      insert into report_exports(organization_id,pantry_location_id,report_type,format,date_from,date_to,filters,row_count,generated_by,request_id)
      values(${input.scope.organizationId}::uuid,${input.scope.locationId}::uuid,${input.reportType},'csv',${input.filters.dateFrom}::date,${input.filters.dateTo}::date,${JSON.stringify(filters)}::jsonb,${input.rowCount},${input.actorUserId}::uuid,${input.requestId}::uuid)
      returning id
    `).then((result) => result.rows);
    await tx.execute(sql`
      insert into audit_logs(organization_id,location_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,new_values,metadata)
      values(${input.scope.organizationId}::uuid,${input.scope.locationId}::uuid,${input.actorUserId}::uuid,${membership.id}::uuid,
        'report.exported','report_export',${created!.id}::uuid,${input.requestId}::uuid,
        ${JSON.stringify({ reportType: input.reportType, format: "csv", rowCount: input.rowCount })}::jsonb,
        ${JSON.stringify({ filters })}::jsonb)
    `);
    return created!;
  });
}

export type AuthorizedReport = { scope: ResolvedScope; data: ReportData };

