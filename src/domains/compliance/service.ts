import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

export async function recordEligibilityVerification(input: { actorId: string; organizationId: string; locationId: string; householdId: string; programCode: string; status: "pending" | "verified" | "expired" | "denied" | "manual_review"; expiresAt?: Date | null; evidenceReference?: string | null; notes?: string | null }) {
  if (!(await hasLocationPermission(db, input.actorId, input.locationId, "eligibility.manage"))) throw new DomainError("FORBIDDEN");
  if (!/^[A-Z0-9_-]{2,40}$/.test(input.programCode)) throw new DomainError("VALIDATION_ERROR");
  const result = await db.execute(sql`
    insert into eligibility_verifications(organization_id,pantry_location_id,household_id,program_code,status,verified_at,expires_at,evidence_reference,notes,verified_by)
    values(${input.organizationId}::uuid,${input.locationId}::uuid,${input.householdId}::uuid,${input.programCode},${input.status},case when ${input.status} = 'verified' then now() else null end,${input.expiresAt ?? null},${input.evidenceReference ?? null},${input.notes ?? null},${input.actorId}::uuid)
    returning id,status,expires_at
  `);
  return result.rows[0];
}

export async function saveComplianceProfile(input: { actorId: string; organizationId: string; countryCode: string; enabled: boolean; rules: Record<string, unknown> }) {
  if (!(await hasOrganizationPermission(db, input.actorId, input.organizationId, "compliance.manage"))) throw new DomainError("FORBIDDEN");
  if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new DomainError("VALIDATION_ERROR");
  const result = await db.execute(sql`
    insert into compliance_profiles(organization_id,country_code,enabled,rules,created_by)
    values(${input.organizationId}::uuid,${input.countryCode},${input.enabled},${JSON.stringify(input.rules)}::jsonb,${input.actorId}::uuid)
    on conflict(organization_id,country_code) do update set enabled=excluded.enabled,rules=excluded.rules,updated_at=now()
    returning id,country_code,enabled,rules
  `);
  return result.rows[0];
}

export async function listComplianceProfiles(actorId: string, organizationId: string) {
  if (!(await hasOrganizationPermission(db, actorId, organizationId, "organization.view"))) throw new DomainError("FORBIDDEN");
  return (await db.execute(sql`select country_code,enabled,rules from compliance_profiles where organization_id=${organizationId}::uuid order by country_code`)).rows;
}
