import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasOrganizationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

export type ReportDefinitionInput = {
  name: string;
  slug: string;
  description?: string | null;
  definition: { source: string; columns: string[]; filters?: Record<string, unknown>; groupBy?: string[]; sort?: string[] };
  shared?: boolean;
};

function validateDefinition(input: ReportDefinitionInput) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new DomainError("VALIDATION_ERROR");
  if (input.name.trim().length < 2 || input.name.length > 120) throw new DomainError("VALIDATION_ERROR");
  if (!input.definition.source || input.definition.columns.length === 0 || input.definition.columns.length > 50) throw new DomainError("VALIDATION_ERROR");
}

export async function saveReportDefinition(actorId: string, organizationId: string, input: ReportDefinitionInput) {
  if (!(await hasOrganizationPermission(db, actorId, organizationId, "report.design"))) throw new DomainError("FORBIDDEN");
  validateDefinition(input);
  const result = await db.execute<{ id: string }>(sql`
    insert into report_definitions(organization_id,name,slug,description,definition,shared,created_by)
    values(${organizationId}::uuid,${input.name.trim()},${input.slug},${input.description?.trim() || null},${JSON.stringify(input.definition)}::jsonb,${input.shared ?? false},${actorId}::uuid)
    on conflict(organization_id,slug) do update set name=excluded.name,description=excluded.description,definition=excluded.definition,shared=excluded.shared,updated_at=now()
    returning id
  `);
  return result.rows[0];
}

export async function listReportDefinitions(actorId: string, organizationId: string) {
  if (!(await hasOrganizationPermission(db, actorId, organizationId, "report.view"))) throw new DomainError("FORBIDDEN");
  const result = await db.execute(sql`select id,name,slug,description,definition,shared,created_at,updated_at from report_definitions where organization_id=${organizationId}::uuid and (shared or created_by=${actorId}::uuid) order by name`);
  return result.rows;
}
