import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { db } from "@/lib/database/client";

type Executor = Pick<typeof db, "execute">;

async function allowed(executor: Executor, query: SQL) {
  const result = await executor.execute<{ allowed: boolean }>(query);
  return result.rows[0]?.allowed === true;
}

export function hasOrganizationPermission(
  executor: Executor,
  userId: string,
  organizationId: string,
  permission: string,
) {
  return allowed(executor, sql`
    select exists (
      select 1
      from organization_memberships om
      join organizations o on o.id = om.organization_id
      join membership_roles mr on mr.organization_membership_id = om.id
      join roles r on r.id = mr.role_id
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where om.user_id = ${userId}::uuid
        and om.organization_id = ${organizationId}::uuid
        and om.status = 'active' and om.archived_at is null
        and o.status = 'active'
        and r.scope = 'organization' and r.archived_at is null
        and (r.organization_id is null or r.organization_id = om.organization_id)
        and mr.location_id is null and mr.archived_at is null
        and (mr.expires_at is null or mr.expires_at > now())
        and p.key = ${permission}
    ) as allowed
  `);
}

/**
 * True when the user holds the permission organization-wide OR through a location-scoped role at
 * any active location in the organization. Used for organization-owned records (households,
 * package templates) that location-scoped managers operate on.
 */
export function hasPermissionAnywhereInOrganization(
  executor: Executor,
  userId: string,
  organizationId: string,
  permission: string,
) {
  return allowed(executor, sql`
    select exists (
      select 1
      from organization_memberships om
      join organizations o on o.id = om.organization_id
      join membership_roles mr on mr.organization_membership_id = om.id
      join roles r on r.id = mr.role_id
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where om.user_id = ${userId}::uuid
        and om.organization_id = ${organizationId}::uuid
        and om.status = 'active' and om.archived_at is null
        and o.status = 'active'
        and r.archived_at is null
        and (r.organization_id is null or r.organization_id = om.organization_id)
        and mr.archived_at is null
        and (mr.expires_at is null or mr.expires_at > now())
        and p.key = ${permission}
        and (
          (r.scope = 'organization' and mr.location_id is null)
          or (
            r.scope = 'location' and mr.location_id is not null
            and exists (
              select 1 from location_memberships lm
              where lm.organization_membership_id = om.id and lm.location_id = mr.location_id
                and lm.status = 'active' and lm.archived_at is null
            )
            and exists (
              select 1 from pantry_locations pl
              where pl.id = mr.location_id and pl.organization_id = om.organization_id and pl.status <> 'archived'
            )
          )
        )
    ) as allowed
  `);
}

export function hasLocationPermission(
  executor: Executor,
  userId: string,
  locationId: string,
  permission: string,
) {
  return allowed(executor, sql`
    select exists (
      select 1
      from pantry_locations l
      join organizations o on o.id = l.organization_id
      where l.id = ${locationId}::uuid and l.status <> 'archived' and o.status = 'active'
        and (
          exists (
            select 1
            from organization_memberships om
            join membership_roles mr on mr.organization_membership_id = om.id
            join roles r on r.id = mr.role_id
            join role_permissions rp on rp.role_id = r.id
            join permissions p on p.id = rp.permission_id
            where om.user_id = ${userId}::uuid and om.organization_id = l.organization_id
              and om.status = 'active' and om.archived_at is null
              and r.scope = 'organization' and r.archived_at is null
              and mr.location_id is null and mr.archived_at is null
              and (mr.expires_at is null or mr.expires_at > now()) and p.key = ${permission}
          )
          or exists (
            select 1
            from organization_memberships om
            join location_memberships lm on lm.organization_membership_id = om.id and lm.location_id = l.id
            join membership_roles mr on mr.organization_membership_id = om.id and mr.location_id = l.id
            join roles r on r.id = mr.role_id
            join role_permissions rp on rp.role_id = r.id
            join permissions p on p.id = rp.permission_id
            where om.user_id = ${userId}::uuid and om.organization_id = l.organization_id
              and om.status = 'active' and om.archived_at is null
              and lm.status = 'active' and lm.archived_at is null
              and r.scope = 'location' and r.archived_at is null
              and mr.archived_at is null and (mr.expires_at is null or mr.expires_at > now())
              and p.key = ${permission}
          )
        )
    ) as allowed
  `);
}
