import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { OnboardingInput } from "@/domains/onboarding/schemas";
import { db } from "@/lib/database/client";
import {
  auditLogs,
  locationMemberships,
  membershipRoles,
  operationRequests,
  organizationMemberships,
  organizations,
  pantryLocations,
  userProfiles,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";

const administratorRoleId = "00000000-0000-4000-8000-000000000001";

export async function onboardOrganization(userId: string, input: OnboardingInput, requestId: string) {
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.transaction(async (transaction) => {
    const [prior] = await transaction
      .select()
      .from(operationRequests)
      .where(and(eq(operationRequests.actorUserId, userId), eq(operationRequests.operation, "organization.onboard"), eq(operationRequests.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT");
      if (prior.status === "completed") return prior.response as { organizationId: string; organizationSlug: string; locationId: string; membershipId: string };
      throw new DomainError("OPERATION_IN_PROGRESS");
    }

    const activeMembership = await transaction
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
      .limit(1);
    if (activeMembership.length > 0) throw new DomainError("ONBOARDING_ALREADY_COMPLETE");

    await transaction.insert(operationRequests).values({ actorUserId: userId, operation: "organization.onboard", idempotencyKey: input.idempotencyKey, requestHash });
    await transaction.update(userProfiles).set({
      displayName: input.profile.displayName,
      firstName: input.profile.firstName || null,
      lastName: input.profile.lastName || null,
      preferredLocale: input.profile.preferredLocale,
    }).where(eq(userProfiles.id, userId));

    const [organization] = await transaction.insert(organizations).values({
      name: input.organization.name,
      slug: input.organization.slug,
      timezone: input.organization.timezone,
      defaultLocale: input.organization.defaultLocale,
      phoneNumber: input.organization.phoneNumber || null,
      email: input.organization.email || null,
      addressLine1: input.organization.addressLine1 || null,
      addressLine2: input.organization.addressLine2 || null,
      city: input.organization.city || null,
      stateRegion: input.organization.stateRegion || null,
      postalCode: input.organization.postalCode || null,
      countryCode: input.organization.countryCode,
      createdBy: userId,
    }).returning();
    const [location] = await transaction.insert(pantryLocations).values({
      organizationId: organization.id,
      name: input.location.name,
      slug: input.location.slug,
      timezone: input.location.timezone || null,
      phoneNumber: input.location.phoneNumber || null,
      email: input.location.email || null,
      addressLine1: input.location.addressLine1 || null,
      addressLine2: input.location.addressLine2 || null,
      city: input.location.city || null,
      stateRegion: input.location.stateRegion || null,
      postalCode: input.location.postalCode || null,
      countryCode: input.location.countryCode,
      operatingNotes: input.location.operatingNotes || null,
      createdBy: userId,
    }).returning();
    const [membership] = await transaction.insert(organizationMemberships).values({
      organizationId: organization.id,
      userId,
      status: "active",
      allLocations: true,
      joinedAt: new Date(),
    }).returning();
    await transaction.insert(locationMemberships).values({ organizationMembershipId: membership.id, organizationId: organization.id, locationId: location.id, status: "active", createdBy: userId });
    const [assignment] = await transaction.insert(membershipRoles).values({ organizationMembershipId: membership.id, roleId: administratorRoleId, assignedBy: userId }).returning();
    await transaction.update(userProfiles).set({ defaultOrganizationId: organization.id, defaultLocationId: location.id }).where(eq(userProfiles.id, userId));
    await transaction.insert(auditLogs).values([
      { organizationId: organization.id, actorUserId: userId, actorMembershipId: membership.id, action: "organization.created", entityType: "organization", entityId: organization.id, requestId, newValues: { name: organization.name, slug: organization.slug, status: organization.status } },
      { organizationId: organization.id, locationId: location.id, actorUserId: userId, actorMembershipId: membership.id, action: "location.created", entityType: "pantry_location", entityId: location.id, requestId, newValues: { name: location.name, slug: location.slug, status: location.status } },
      { organizationId: organization.id, actorUserId: userId, actorMembershipId: membership.id, action: "role.assigned", entityType: "membership_role", entityId: assignment.id, requestId, newValues: { role: "administrator", membershipId: membership.id } },
    ]);
    const result = { organizationId: organization.id, organizationSlug: organization.slug, locationId: location.id, membershipId: membership.id };
    await transaction.update(operationRequests).set({ organizationId: organization.id, status: "completed", response: result, completedAt: new Date() }).where(and(eq(operationRequests.actorUserId, userId), eq(operationRequests.operation, "organization.onboard"), eq(operationRequests.idempotencyKey, input.idempotencyKey)));
    return result;
  });
}
