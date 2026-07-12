import "server-only";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { resolveEffectivePermissions, selectActiveId } from "@/domains/access/policy";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/database/client";
import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import {
  locationMemberships,
  membershipRoles,
  organizationMemberships,
  organizations,
  pantryLocations,
  permissions,
  rolePermissions,
  roles,
  userProfiles,
} from "@/lib/database/schema";

export type PermissionKey = `${string}.${string}`;

export type Profile = {
  id: string;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  preferredLocale: string;
  defaultOrganizationId: string | null;
  defaultLocationId: string | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived";
  timezone: string;
  defaultLocale: string;
};

export type LocationSummary = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: "active" | "temporarily_closed" | "archived";
  timezone: string | null;
};

export type RoleAssignment = {
  id: string;
  roleId: string;
  locationId: string | null;
  roleName: string;
  roleSlug: string;
  scope: "organization" | "location";
  permissions: PermissionKey[];
};

export type OrganizationAccess = {
  membershipId: string;
  membershipStatus: "invited" | "active" | "suspended" | "archived";
  allLocations: boolean;
  organization: OrganizationSummary;
  locations: LocationSummary[];
  assignments: RoleAssignment[];
  organizationPermissions: PermissionKey[];
  locationPermissions: Record<string, PermissionKey[]>;
};

export const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

export const requireUser = cache(async () => {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/sign-in");
  return currentUser;
});

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null;
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, currentUser.id)).limit(1);
  if (!profile) return null;
  return profile;
});

export const getOrganizationAccessList = cache(async (): Promise<OrganizationAccess[]> => {
  const currentUser = await requireUser();
  const membershipRows = await db
    .select({
      membershipId: organizationMemberships.id,
      membershipStatus: organizationMemberships.status,
      allLocations: organizationMemberships.allLocations,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      organizationStatus: organizations.status,
      timezone: organizations.timezone,
      defaultLocale: organizations.defaultLocale,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, currentUser.id), eq(organizationMemberships.status, "active"), isNull(organizationMemberships.archivedAt), eq(organizations.status, "active")))
    .orderBy(organizationMemberships.createdAt);

  if (membershipRows.length === 0) return [];
  const membershipIds = membershipRows.map((row) => row.membershipId);
  const organizationIds = membershipRows.map((row) => row.organizationId);
  const [assignmentRows, locationRows, locationMembershipRows] = await Promise.all([
    db
      .select({
        assignmentId: membershipRoles.id,
        membershipId: membershipRoles.organizationMembershipId,
        roleId: roles.id,
        locationId: membershipRoles.locationId,
        roleName: roles.name,
        roleSlug: roles.slug,
        scope: roles.scope,
        permission: permissions.key,
      })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(inArray(membershipRoles.organizationMembershipId, membershipIds), isNull(membershipRoles.archivedAt), isNull(roles.archivedAt), or(isNull(membershipRoles.expiresAt), gt(membershipRoles.expiresAt, new Date())))),
    db.select().from(pantryLocations).where(and(inArray(pantryLocations.organizationId, organizationIds), or(eq(pantryLocations.status, "active"), eq(pantryLocations.status, "temporarily_closed")))).orderBy(pantryLocations.name),
    db.select({ membershipId: locationMemberships.organizationMembershipId, locationId: locationMemberships.locationId }).from(locationMemberships).where(and(inArray(locationMemberships.organizationMembershipId, membershipIds), eq(locationMemberships.status, "active"), isNull(locationMemberships.archivedAt))),
  ]);

  const activeLocationMemberships = new Set(locationMembershipRows.map((row) => `${row.membershipId}:${row.locationId}`));

  return membershipRows.map((membership) => {
    const assignmentMap = new Map<string, RoleAssignment>();
    assignmentRows.filter((row) => row.membershipId === membership.membershipId).forEach((row) => {
      const assignment = assignmentMap.get(row.assignmentId) ?? {
        id: row.assignmentId,
        roleId: row.roleId,
        locationId: row.locationId,
        roleName: row.roleName,
        roleSlug: row.roleSlug,
        scope: row.scope,
        permissions: [],
      };
      assignment.permissions.push(row.permission as PermissionKey);
      assignmentMap.set(row.assignmentId, assignment);
    });
    const assignments = Array.from(assignmentMap.values());
    const organizationPermissions = Array.from(new Set(assignments.filter((item) => item.scope === "organization").flatMap((item) => item.permissions)));
    const locationPermissions: Record<string, PermissionKey[]> = {};
    assignments.filter((item) => item.locationId).forEach((item) => {
      locationPermissions[item.locationId!] = Array.from(new Set([...(locationPermissions[item.locationId!] ?? []), ...item.permissions]));
    });
    const canViewAllLocations = organizationPermissions.includes("location.view");
    const visibleLocations = locationRows.filter((location) =>
      location.organizationId === membership.organizationId &&
      (canViewAllLocations || (activeLocationMemberships.has(`${membership.membershipId}:${location.id}`) && locationPermissions[location.id]?.includes("location.view"))),
    );
    return {
      membershipId: membership.membershipId,
      membershipStatus: membership.membershipStatus,
      allLocations: membership.allLocations,
      organization: {
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        status: membership.organizationStatus,
        timezone: membership.timezone,
        defaultLocale: membership.defaultLocale,
      },
      locations: visibleLocations,
      assignments,
      organizationPermissions,
      locationPermissions,
    };
  });
});

export async function resolveLandingPath() {
  const currentUser = await requireUser();
  const [profile, accessList, memberships] = await Promise.all([
    getCurrentProfile(),
    getOrganizationAccessList(),
    db.select({ status: organizationMemberships.status }).from(organizationMemberships).where(eq(organizationMemberships.userId, currentUser.id)),
  ]);
  if (accessList.length > 0) {
    const selected = accessList.find((access) => access.organization.id === profile?.defaultOrganizationId) ?? accessList[0];
    return `/app/${selected.organization.slug}/dashboard`;
  }
  return memberships.some((membership) => ["suspended", "archived"].includes(membership.status)) ? "/access-blocked" : "/onboarding";
}

export const requireOrganizationContext = cache(async (organizationSlug: string) => {
  const currentUser = await requireUser();
  const [profile, accessList] = await Promise.all([getCurrentProfile(), getOrganizationAccessList()]);
  const access = accessList.find((item) => item.organization.slug === organizationSlug);
  if (!access) notFound();
  const activeLocationId = selectActiveId(access.locations, profile?.defaultLocationId);
  const activeLocation = access.locations.find((location) => location.id === activeLocationId) ?? null;
  const effectivePermissions = resolveEffectivePermissions(access.assignments, activeLocationId) as Set<PermissionKey>;
  return { user: currentUser, profile, access, accessList, activeLocation, effectivePermissions };
});

export function can(permissions: ReadonlySet<PermissionKey>, permission: PermissionKey) {
  return permissions.has(permission);
}

export async function verifyOrganizationPermission(organizationId: string, permission: PermissionKey) {
  const currentUser = await requireUser();
  return hasOrganizationPermission(db, currentUser.id, organizationId, permission);
}

export async function verifyLocationPermission(locationId: string, permission: PermissionKey) {
  const currentUser = await requireUser();
  return hasLocationPermission(db, currentUser.id, locationId, permission);
}
