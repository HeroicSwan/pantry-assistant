import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import {
  auditLogs,
  locationMemberships,
  membershipRoles,
  organizationInvitations,
  organizationMemberships,
  organizations,
  pantryLocations,
  roles,
  userProfiles,
} from "@/lib/database/schema";

export async function getMemberCountForUser(userId: string, organizationId: string) {
  if (!(await hasOrganizationPermission(db, userId, organizationId, "member.view"))) return null;
  const [result] = await db.select({ value: count() }).from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organizationId), ne(organizationMemberships.status, "archived")));
  return result.value;
}

export async function getOrganizationSettingsForUser(userId: string, organizationId: string) {
  if (!(await hasOrganizationPermission(db, userId, organizationId, "organization.update"))) return null;
  const [row] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!row) return null;
  return {
    id: row.id, name: row.name, slug: row.slug, timezone: row.timezone,
    default_locale: row.defaultLocale, email: row.email, phone_number: row.phoneNumber,
    address_line_1: row.addressLine1, address_line_2: row.addressLine2, city: row.city,
    state_region: row.stateRegion, postal_code: row.postalCode, country_code: row.countryCode,
  };
}

export async function getLocationsForUser(userId: string, organizationId: string) {
  const mayViewArchive = await hasOrganizationPermission(db, userId, organizationId, "location.archive");
  const rows = await db.select().from(pantryLocations).where(eq(pantryLocations.organizationId, organizationId)).orderBy(asc(pantryLocations.name));
  const visible = [];
  for (const row of rows) {
    if ((row.status === "archived" && mayViewArchive) || (row.status !== "archived" && await hasLocationPermission(db, userId, row.id, "location.view"))) visible.push(row);
  }
  return visible.map((row) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status, timezone: row.timezone, city: row.city, state_region: row.stateRegion }));
}

export async function getLocationForUser(userId: string, organizationId: string, locationId: string) {
  const [row] = await db.select().from(pantryLocations).where(and(eq(pantryLocations.id, locationId), eq(pantryLocations.organizationId, organizationId))).limit(1);
  if (!row) return null;
  const allowed = row.status === "archived"
    ? await hasOrganizationPermission(db, userId, organizationId, "location.archive")
    : await hasLocationPermission(db, userId, locationId, "location.view");
  if (!allowed) return null;
  return {
    id: row.id, organization_id: row.organizationId, name: row.name, slug: row.slug,
    status: row.status, timezone: row.timezone, phone_number: row.phoneNumber, email: row.email,
    address_line_1: row.addressLine1, address_line_2: row.addressLine2, city: row.city,
    state_region: row.stateRegion, postal_code: row.postalCode, country_code: row.countryCode,
    operating_notes: row.operatingNotes,
  };
}

export async function getTeamDataForUser(userId: string, organizationId: string) {
  if (!(await hasOrganizationPermission(db, userId, organizationId, "member.view"))) return null;
  const members = await db.select().from(organizationMemberships).where(eq(organizationMemberships.organizationId, organizationId)).orderBy(organizationMemberships.createdAt);
  const memberIds = members.map((member) => member.id);
  const userIds = members.map((member) => member.userId);
  const [profiles, availableRoles, assignments, locationAssignments, invitations] = await Promise.all([
    userIds.length ? db.select().from(userProfiles).where(inArray(userProfiles.id, userIds)) : [],
    db.select().from(roles).where(and(or(isNull(roles.organizationId), eq(roles.organizationId, organizationId)), isNull(roles.archivedAt))).orderBy(roles.name),
    memberIds.length ? db.select({ id: membershipRoles.id, organizationMembershipId: membershipRoles.organizationMembershipId, locationId: membershipRoles.locationId, expiresAt: membershipRoles.expiresAt, roleId: roles.id, roleName: roles.name, roleSlug: roles.slug, roleScope: roles.scope }).from(membershipRoles).innerJoin(roles, eq(roles.id, membershipRoles.roleId)).where(and(inArray(membershipRoles.organizationMembershipId, memberIds), isNull(membershipRoles.archivedAt))) : [],
    db.select().from(locationMemberships).where(and(eq(locationMemberships.organizationId, organizationId), ne(locationMemberships.status, "archived"))),
    db.select({ invitation: organizationInvitations, roleName: roles.name, locationName: pantryLocations.name }).from(organizationInvitations).innerJoin(roles, eq(roles.id, organizationInvitations.roleId)).leftJoin(pantryLocations, eq(pantryLocations.id, organizationInvitations.locationId)).where(eq(organizationInvitations.organizationId, organizationId)).orderBy(desc(organizationInvitations.createdAt)),
  ]);
  return {
    members: members.map((row) => ({ id: row.id, user_id: row.userId, status: row.status, all_locations: row.allLocations, joined_at: row.joinedAt?.toISOString() ?? null })),
    profiles: profiles.map((row) => ({ id: row.id, display_name: row.displayName, email: row.email })),
    roles: availableRoles.map((row) => ({ id: row.id, name: row.name, slug: row.slug, scope: row.scope })),
    assignments: assignments.map((row) => ({ id: row.id, organization_membership_id: row.organizationMembershipId, location_id: row.locationId, expires_at: row.expiresAt?.toISOString() ?? null, role: { id: row.roleId, name: row.roleName, slug: row.roleSlug, scope: row.roleScope } })),
    locationAssignments: locationAssignments.map((row) => ({ organization_membership_id: row.organizationMembershipId, location_id: row.locationId, status: row.status })),
    invitations: invitations.map(({ invitation, roleName, locationName }) => ({ id: invitation.id, email: invitation.email, status: invitation.status, expires_at: invitation.expiresAt.toISOString(), role: { name: roleName }, location: locationName ? { name: locationName } : null })),
  };
}

export type AuditFilters = { action?: string; actor?: string; entity?: string; location?: string; from?: string; to?: string };

export async function getAuditDataForUser(userId: string, organizationId: string, filters: AuditFilters) {
  if (!(await hasOrganizationPermission(db, userId, organizationId, "audit.view"))) return null;
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (filters.action) conditions.push(ilike(auditLogs.action, `%${filters.action.replaceAll("%", "")}%`));
  if (filters.actor) conditions.push(eq(auditLogs.actorUserId, filters.actor));
  if (filters.entity) conditions.push(eq(auditLogs.entityType, filters.entity));
  if (filters.location) conditions.push(eq(auditLogs.locationId, filters.location));
  if (filters.from) conditions.push(gte(auditLogs.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
  if (filters.to) conditions.push(lte(auditLogs.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
  const rows = await db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(100);
  const actorIds = Array.from(new Set(rows.flatMap((row) => row.actorUserId ? [row.actorUserId] : [])));
  const actors = actorIds.length ? await db.select().from(userProfiles).where(inArray(userProfiles.id, actorIds)) : [];
  return {
    logs: rows.map((row) => ({ id: row.id, action: row.action, entity_type: row.entityType, entity_id: row.entityId, source: row.source, reason: row.reason, actor_user_id: row.actorUserId, location_id: row.locationId, created_at: row.createdAt.toISOString(), request_id: row.requestId })),
    actors: actors.map((row) => ({ id: row.id, display_name: row.displayName, email: row.email })),
  };
}
