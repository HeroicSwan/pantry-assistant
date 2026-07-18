import "server-only";

import { and, count, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  locationSchema,
  organizationSettingsSchema,
  profileSchema,
} from "@/domains/admin/schemas";
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
  permissions,
  rolePermissions,
  roles,
  user,
  userProfiles,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";

type ProfileInput = z.infer<typeof profileSchema>;
type OrganizationInput = z.infer<typeof organizationSettingsSchema>;
type LocationInput = z.infer<typeof locationSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const administratorRoleId = "00000000-0000-4000-8000-000000000001";

async function requireOrganizationPermission(transaction: Transaction, actorId: string, organizationId: string, permission: string) {
  if (!(await hasOrganizationPermission(transaction, actorId, organizationId, permission))) throw new DomainError("FORBIDDEN");
}

async function requireLocationPermission(transaction: Transaction, actorId: string, locationId: string, permission: string) {
  if (!(await hasLocationPermission(transaction, actorId, locationId, permission))) throw new DomainError("FORBIDDEN");
}

async function actorMembership(transaction: Transaction, actorId: string, organizationId: string) {
  const [membership] = await transaction.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(eq(organizationMemberships.userId, actorId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active"), isNull(organizationMemberships.archivedAt))).limit(1);
  if (!membership) throw new DomainError("FORBIDDEN");
  return membership.id;
}

export async function updateOwnProfile(actorId: string, values: ProfileInput) {
  await db.transaction(async (transaction) => {
    await transaction.update(userProfiles).set({ displayName: values.displayName, firstName: values.firstName || null, lastName: values.lastName || null, phoneNumber: values.phoneNumber || null, preferredLocale: values.preferredLocale }).where(eq(userProfiles.id, actorId));
    await transaction.update(user).set({ name: values.displayName }).where(eq(user.id, actorId));
  });
}

export async function createCustomRole(actorId: string, organizationId: string, input: { name: string; slug: string; description: string; scope: "organization" | "location"; permissionKeys: string[] }, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "role.manage");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.name.trim().length < 2 || input.permissionKeys.length > 200) throw new DomainError("VALIDATION_ERROR");
    const [role] = await transaction.insert(roles).values({ organizationId, name: input.name.trim(), slug: input.slug, description: input.description.trim(), scope: input.scope, isSystemRole: false, isEditable: true, createdBy: actorId }).returning();
    const permissionRows = input.permissionKeys.length ? await transaction.select({ id: permissions.id }).from(permissions).where(sql`key = any(${input.permissionKeys}::text[])`) : [];
    if (permissionRows.length) await transaction.insert(rolePermissions).values(permissionRows.map((permission) => ({ roleId: role.id, permissionId: permission.id })));
    await transaction.insert(auditLogs).values({ organizationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "role.created", entityType: "role", entityId: role.id, requestId, newValues: { name: role.name, slug: role.slug, scope: role.scope, permissionCount: permissionRows.length } });
    return role;
  });
}

export async function setActiveScope(actorId: string, organizationId: string, locationId: string | null) {
  await db.transaction(async (transaction) => {
    const [membership] = await transaction.select({ id: organizationMemberships.id }).from(organizationMemberships).innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId)).where(and(eq(organizationMemberships.userId, actorId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active"), eq(organizations.status, "active"))).limit(1);
    if (!membership) throw new DomainError("FORBIDDEN");
    if (locationId) {
      const [location] = await transaction.select({ organizationId: pantryLocations.organizationId }).from(pantryLocations).where(and(eq(pantryLocations.id, locationId), ne(pantryLocations.status, "archived"))).limit(1);
      if (!location || location.organizationId !== organizationId || !(await hasLocationPermission(transaction, actorId, locationId, "location.view"))) throw new DomainError("FORBIDDEN");
    }
    await transaction.update(userProfiles).set({ defaultOrganizationId: organizationId, defaultLocationId: locationId }).where(eq(userProfiles.id, actorId));
  });
}

export async function updateOrganization(actorId: string, organizationId: string, values: OrganizationInput, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "organization.update");
    const [previous] = await transaction.select().from(organizations).where(and(eq(organizations.id, organizationId), eq(organizations.status, "active"))).limit(1);
    if (!previous) throw new DomainError("NOT_FOUND");
    const [updated] = await transaction.update(organizations).set({ name: values.name, timezone: values.timezone, defaultLocale: values.defaultLocale, phoneNumber: values.phoneNumber || null, email: values.email || null, addressLine1: values.addressLine1 || null, addressLine2: values.addressLine2 || null, city: values.city || null, stateRegion: values.stateRegion || null, postalCode: values.postalCode || null, countryCode: values.countryCode }).where(eq(organizations.id, organizationId)).returning();
    await transaction.insert(auditLogs).values({ organizationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "organization.updated", entityType: "organization", entityId: organizationId, requestId, previousValues: { name: previous.name, timezone: previous.timezone, defaultLocale: previous.defaultLocale }, newValues: { name: updated.name, timezone: updated.timezone, defaultLocale: updated.defaultLocale } });
    return updated;
  });
}

export async function createLocation(actorId: string, organizationId: string, values: LocationInput & { slug: string }, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "location.create");
    const [created] = await transaction.insert(pantryLocations).values({ organizationId, name: values.name, slug: values.slug, status: values.status, timezone: values.timezone || null, phoneNumber: values.phoneNumber || null, email: values.email || null, addressLine1: values.addressLine1 || null, addressLine2: values.addressLine2 || null, city: values.city || null, stateRegion: values.stateRegion || null, postalCode: values.postalCode || null, countryCode: values.countryCode, operatingNotes: values.operatingNotes || null, createdBy: actorId }).returning();
    await transaction.insert(auditLogs).values({ organizationId, locationId: created.id, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "location.created", entityType: "pantry_location", entityId: created.id, requestId, newValues: { name: created.name, slug: created.slug, status: created.status } });
    return created;
  });
}

export async function updateLocation(actorId: string, locationId: string, values: Omit<LocationInput, "slug">, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireLocationPermission(transaction, actorId, locationId, "location.update");
    const [previous] = await transaction.select().from(pantryLocations).where(and(eq(pantryLocations.id, locationId), ne(pantryLocations.status, "archived"))).limit(1);
    if (!previous) throw new DomainError("NOT_FOUND");
    const [updated] = await transaction.update(pantryLocations).set({ name: values.name, status: values.status, timezone: values.timezone || null, phoneNumber: values.phoneNumber || null, email: values.email || null, addressLine1: values.addressLine1 || null, addressLine2: values.addressLine2 || null, city: values.city || null, stateRegion: values.stateRegion || null, postalCode: values.postalCode || null, countryCode: values.countryCode, operatingNotes: values.operatingNotes || null }).where(eq(pantryLocations.id, locationId)).returning();
    await transaction.insert(auditLogs).values({ organizationId: updated.organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, updated.organizationId), action: "location.updated", entityType: "pantry_location", entityId: locationId, requestId, previousValues: { name: previous.name, status: previous.status, timezone: previous.timezone }, newValues: { name: updated.name, status: updated.status, timezone: updated.timezone } });
    return updated;
  });
}

export async function archiveLocation(actorId: string, locationId: string, reason: string, requestId: string) {
  await db.transaction(async (transaction) => {
    const [location] = await transaction.select().from(pantryLocations).where(eq(pantryLocations.id, locationId)).limit(1);
    if (!location) throw new DomainError("NOT_FOUND");
    await requireOrganizationPermission(transaction, actorId, location.organizationId, "location.archive");
    const [{ value: activeCount }] = await transaction.select({ value: count() }).from(pantryLocations).where(and(eq(pantryLocations.organizationId, location.organizationId), ne(pantryLocations.status, "archived")));
    if (activeCount <= 1) throw new DomainError("FINAL_ACTIVE_LOCATION");
    await transaction.update(membershipRoles).set({ archivedAt: new Date() }).where(and(eq(membershipRoles.locationId, locationId), isNull(membershipRoles.archivedAt)));
    await transaction.update(locationMemberships).set({ status: "archived", archivedAt: new Date() }).where(and(eq(locationMemberships.locationId, locationId), ne(locationMemberships.status, "archived")));
    await transaction.update(pantryLocations).set({ status: "archived", archivedAt: new Date() }).where(eq(pantryLocations.id, locationId));
    await transaction.update(userProfiles).set({ defaultLocationId: null }).where(eq(userProfiles.defaultLocationId, locationId));
    await transaction.insert(auditLogs).values({ organizationId: location.organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, location.organizationId), action: "location.archived", entityType: "pantry_location", entityId: locationId, requestId, reason, previousValues: { status: location.status }, newValues: { status: "archived" } });
  });
}

export async function prepareInvitation(actorId: string, organizationId: string, email: string, roleId: string, locationId: string | null, tokenHash: string, expiresAt: Date, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "member.invite");
    const [role] = await transaction.select().from(roles).where(and(eq(roles.id, roleId), isNull(roles.archivedAt))).limit(1);
    if (!role || (role.organizationId && role.organizationId !== organizationId) || (role.scope === "organization" ? locationId !== null : locationId === null)) throw new DomainError("INVALID_ROLE_SCOPE");
    if (locationId) {
      const [location] = await transaction.select({ id: pantryLocations.id }).from(pantryLocations).where(and(eq(pantryLocations.id, locationId), eq(pantryLocations.organizationId, organizationId), ne(pantryLocations.status, "archived"))).limit(1);
      if (!location) throw new DomainError("INVALID_ROLE_SCOPE");
    }
    const normalizedEmail = email.toLowerCase();
    const [prior] = await transaction.select().from(organizationInvitations).where(and(eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.email, normalizedEmail), eq(organizationInvitations.status, "pending"))).limit(1);
    if (prior) await transaction.update(organizationInvitations).set({ status: "revoked", revokedAt: new Date() }).where(eq(organizationInvitations.id, prior.id));
    const [invitation] = await transaction.insert(organizationInvitations).values({ organizationId, email: normalizedEmail, tokenHash, roleId, locationId, expiresAt, invitedBy: actorId }).returning();
    await transaction.insert(auditLogs).values({ organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "invitation.prepared", entityType: "organization_invitation", entityId: invitation.id, requestId, newValues: { email: normalizedEmail, roleId, locationId, status: "pending", expiresAt: expiresAt.toISOString() } });
    return invitation;
  });
}

export async function revokeInvitation(actorId: string, organizationId: string, invitationId: string, reason: string, requestId: string) {
  await db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "member.invite");
    const [updated] = await transaction.update(organizationInvitations).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.organizationId, organizationId), eq(organizationInvitations.status, "pending"))).returning();
    if (!updated) throw new DomainError("NOT_FOUND");
    await transaction.insert(auditLogs).values({ organizationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "invitation.revoked", entityType: "organization_invitation", entityId: invitationId, requestId, reason, previousValues: { status: "pending" }, newValues: { status: "revoked" } });
  });
}

export async function assignMemberLocation(actorId: string, organizationId: string, membershipId: string, locationId: string, requestId: string) {
  await db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "member.update");
    const [target] = await transaction.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(eq(organizationMemberships.id, membershipId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active"))).limit(1);
    const [location] = await transaction.select({ id: pantryLocations.id }).from(pantryLocations).where(and(eq(pantryLocations.id, locationId), eq(pantryLocations.organizationId, organizationId), ne(pantryLocations.status, "archived"))).limit(1);
    if (!target || !location) throw new DomainError("NOT_FOUND");
    await transaction.insert(locationMemberships).values({ organizationMembershipId: membershipId, organizationId, locationId, status: "active", createdBy: actorId }).onConflictDoUpdate({ target: [locationMemberships.organizationMembershipId, locationMemberships.locationId], set: { status: "active", archivedAt: null } });
    await transaction.insert(auditLogs).values({ organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "location_membership.assigned", entityType: "organization_membership", entityId: membershipId, requestId, newValues: { locationId } });
  });
}

export async function removeMemberLocation(actorId: string, organizationId: string, membershipId: string, locationId: string, reason: string, requestId: string) {
  await db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "member.update");
    await transaction.update(membershipRoles).set({ archivedAt: new Date() }).where(and(eq(membershipRoles.organizationMembershipId, membershipId), eq(membershipRoles.locationId, locationId), isNull(membershipRoles.archivedAt)));
    const [removed] = await transaction.update(locationMemberships).set({ status: "archived", archivedAt: new Date() }).where(and(eq(locationMemberships.organizationMembershipId, membershipId), eq(locationMemberships.organizationId, organizationId), eq(locationMemberships.locationId, locationId), ne(locationMemberships.status, "archived"))).returning();
    if (!removed) throw new DomainError("NOT_FOUND");
    const [target] = await transaction.select({ userId: organizationMemberships.userId }).from(organizationMemberships).where(eq(organizationMemberships.id, membershipId)).limit(1);
    if (target) await transaction.update(userProfiles).set({ defaultLocationId: null }).where(and(eq(userProfiles.id, target.userId), eq(userProfiles.defaultLocationId, locationId)));
    await transaction.insert(auditLogs).values({ organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "location_membership.removed", entityType: "organization_membership", entityId: membershipId, requestId, reason, previousValues: { locationId } });
  });
}

export async function assignMemberRole(actorId: string, organizationId: string, membershipId: string, roleId: string, locationId: string | null, expiresAt: Date | null, requestId: string) {
  return db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "role.assign");
    const [target] = await transaction.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, membershipId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active"))).limit(1);
    const [role] = await transaction.select().from(roles).where(and(eq(roles.id, roleId), isNull(roles.archivedAt))).limit(1);
    if (!target || !role || (role.organizationId && role.organizationId !== organizationId) || (role.scope === "organization" ? locationId !== null : locationId === null) || (expiresAt && expiresAt <= new Date())) throw new DomainError("INVALID_ROLE_ASSIGNMENT");
    if (roleId === administratorRoleId && expiresAt) throw new DomainError("ADMINISTRATOR_CANNOT_EXPIRE");
    if (locationId) {
      const [assignment] = await transaction.select({ id: locationMemberships.id }).from(locationMemberships).where(and(eq(locationMemberships.organizationMembershipId, membershipId), eq(locationMemberships.organizationId, organizationId), eq(locationMemberships.locationId, locationId), eq(locationMemberships.status, "active"), isNull(locationMemberships.archivedAt))).limit(1);
      if (!assignment) throw new DomainError("LOCATION_ASSIGNMENT_REQUIRED");
    }
    const [created] = await transaction.insert(membershipRoles).values({ organizationMembershipId: membershipId, roleId, locationId, assignedBy: actorId, expiresAt }).returning();
    await transaction.insert(auditLogs).values({ organizationId, locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "role.assigned", entityType: "membership_role", entityId: created.id, requestId, newValues: { membershipId, roleId, locationId, expiresAt: expiresAt?.toISOString() ?? null } });
    return created;
  });
}

export async function removeMemberRole(actorId: string, organizationId: string, assignmentId: string, reason: string, requestId: string) {
  await db.transaction(async (transaction) => {
    await requireOrganizationPermission(transaction, actorId, organizationId, "role.assign");
    const [assignment] = await transaction.select({ id: membershipRoles.id, roleId: membershipRoles.roleId, locationId: membershipRoles.locationId, membershipId: membershipRoles.organizationMembershipId }).from(membershipRoles).innerJoin(organizationMemberships, eq(organizationMemberships.id, membershipRoles.organizationMembershipId)).where(and(eq(membershipRoles.id, assignmentId), eq(organizationMemberships.organizationId, organizationId), isNull(membershipRoles.archivedAt))).limit(1);
    if (!assignment) throw new DomainError("NOT_FOUND");
    await transaction.update(membershipRoles).set({ archivedAt: new Date() }).where(eq(membershipRoles.id, assignmentId));
    await transaction.insert(auditLogs).values({ organizationId, locationId: assignment.locationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "role.removed", entityType: "membership_role", entityId: assignmentId, requestId, reason, previousValues: { membershipId: assignment.membershipId, roleId: assignment.roleId, locationId: assignment.locationId } });
  });
}

export async function changeMembershipStatus(actorId: string, organizationId: string, membershipId: string, status: "active" | "suspended" | "archived", reason: string, requestId: string) {
  await db.transaction(async (transaction) => {
    const permission = status === "suspended" ? "member.suspend" : status === "archived" ? "member.archive" : "member.update";
    await requireOrganizationPermission(transaction, actorId, organizationId, permission);
    const [membership] = await transaction.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, membershipId), eq(organizationMemberships.organizationId, organizationId))).limit(1);
    if (!membership) throw new DomainError("NOT_FOUND");
    if (membership.status === "archived") throw new DomainError("MEMBERSHIP_BLOCKED");
    await transaction.update(organizationMemberships).set({ status, joinedAt: status === "active" ? membership.joinedAt ?? new Date() : membership.joinedAt, suspendedAt: status === "suspended" ? new Date() : null, archivedAt: status === "archived" ? new Date() : null }).where(eq(organizationMemberships.id, membershipId));
    if (status === "suspended") await transaction.update(locationMemberships).set({ status: "suspended" }).where(and(eq(locationMemberships.organizationMembershipId, membershipId), eq(locationMemberships.status, "active")));
    if (status === "active") await transaction.update(locationMemberships).set({ status: "active" }).where(and(eq(locationMemberships.organizationMembershipId, membershipId), eq(locationMemberships.status, "suspended"), isNull(locationMemberships.archivedAt)));
    if (status === "archived") {
      await transaction.update(locationMemberships).set({ status: "archived", archivedAt: new Date() }).where(and(eq(locationMemberships.organizationMembershipId, membershipId), ne(locationMemberships.status, "archived")));
      await transaction.update(membershipRoles).set({ archivedAt: new Date() }).where(and(eq(membershipRoles.organizationMembershipId, membershipId), isNull(membershipRoles.archivedAt)));
      await transaction.update(userProfiles).set({ defaultOrganizationId: null, defaultLocationId: null }).where(and(eq(userProfiles.id, membership.userId), eq(userProfiles.defaultOrganizationId, organizationId)));
    }
    await transaction.insert(auditLogs).values({ organizationId, actorUserId: actorId, actorMembershipId: await actorMembership(transaction, actorId, organizationId), action: "membership.status_changed", entityType: "organization_membership", entityId: membershipId, requestId, reason, previousValues: { status: membership.status }, newValues: { status } });
  });
}

export async function acceptInvitation(actorId: string, actorEmail: string, tokenHash: string, requestId: string) {
  return db.transaction(async (transaction) => {
    const [invitation] = await transaction.select().from(organizationInvitations).where(and(eq(organizationInvitations.tokenHash, tokenHash), eq(organizationInvitations.status, "pending"), gt(organizationInvitations.expiresAt, new Date()))).limit(1);
    if (!invitation || invitation.email.toLowerCase() !== actorEmail.toLowerCase()) throw new DomainError("INVALID_OR_EXPIRED_INVITATION");
    const [role] = await transaction.select().from(roles).where(and(eq(roles.id, invitation.roleId), isNull(roles.archivedAt))).limit(1);
    if (!role) throw new DomainError("INVALID_OR_EXPIRED_INVITATION");
    let [membership] = await transaction.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, invitation.organizationId), eq(organizationMemberships.userId, actorId))).limit(1);
    if (!membership) {
      [membership] = await transaction.insert(organizationMemberships).values({ organizationId: invitation.organizationId, userId: actorId, status: "active", allLocations: role.scope === "organization", invitedBy: invitation.invitedBy, invitedAt: invitation.createdAt, joinedAt: new Date() }).returning();
    } else if (membership.status === "invited") {
      [membership] = await transaction.update(organizationMemberships).set({ status: "active", joinedAt: new Date(), allLocations: role.scope === "organization" }).where(eq(organizationMemberships.id, membership.id)).returning();
    } else if (["suspended", "archived"].includes(membership.status)) throw new DomainError("MEMBERSHIP_BLOCKED");
    if (invitation.locationId) await transaction.insert(locationMemberships).values({ organizationMembershipId: membership.id, organizationId: invitation.organizationId, locationId: invitation.locationId, status: "active", createdBy: invitation.invitedBy }).onConflictDoUpdate({ target: [locationMemberships.organizationMembershipId, locationMemberships.locationId], set: { status: "active", archivedAt: null } });
    const [existingRole] = await transaction.select({ id: membershipRoles.id }).from(membershipRoles).where(and(eq(membershipRoles.organizationMembershipId, membership.id), eq(membershipRoles.roleId, invitation.roleId), invitation.locationId ? eq(membershipRoles.locationId, invitation.locationId) : isNull(membershipRoles.locationId), isNull(membershipRoles.archivedAt), or(isNull(membershipRoles.expiresAt), gt(membershipRoles.expiresAt, new Date())))).limit(1);
    if (!existingRole) await transaction.insert(membershipRoles).values({ organizationMembershipId: membership.id, roleId: invitation.roleId, locationId: invitation.locationId, assignedBy: invitation.invitedBy });
    await transaction.update(organizationInvitations).set({ status: "accepted", acceptedBy: actorId, acceptedAt: new Date() }).where(eq(organizationInvitations.id, invitation.id));
    await transaction.update(userProfiles).set({ defaultOrganizationId: invitation.organizationId, defaultLocationId: invitation.locationId }).where(eq(userProfiles.id, actorId));
    await transaction.insert(auditLogs).values({ organizationId: invitation.organizationId, locationId: invitation.locationId, actorUserId: actorId, actorMembershipId: membership.id, action: "invitation.accepted", entityType: "organization_invitation", entityId: invitation.id, requestId, previousValues: { status: "pending" }, newValues: { status: "accepted", membershipId: membership.id } });
    return { organizationId: invitation.organizationId };
  });
}
