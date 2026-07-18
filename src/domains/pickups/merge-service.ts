import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasOrganizationPermission } from "@/lib/database/authorization";
import { auditLogs, households, organizationMemberships } from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";

export async function mergeHouseholds(actorId: string, organizationId: string, sourceHouseholdId: string, targetHouseholdId: string, reason: string, requestId: string) {
  if (sourceHouseholdId === targetHouseholdId) throw new DomainError("VALIDATION_ERROR");
  if (!(await hasOrganizationPermission(db, actorId, organizationId, "household.merge"))) throw new DomainError("FORBIDDEN");
  if (reason.trim().length < 3) throw new DomainError("REASON_REQUIRED");
  return db.transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.select().from(households).where(and(eq(households.id, sourceHouseholdId), eq(households.organizationId, organizationId))).for("update").limit(1),
      tx.select().from(households).where(and(eq(households.id, targetHouseholdId), eq(households.organizationId, organizationId))).for("update").limit(1),
    ]);
    if (!source[0] || !target[0]) throw new DomainError("NOT_FOUND");
    if (source[0].status === "merged" || source[0].status === "archived" || target[0].status !== "active") throw new DomainError("HOUSEHOLD_NOT_ELIGIBLE");
    const membership = await tx.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(eq(organizationMemberships.userId, actorId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active"))).limit(1);
    if (!membership[0]) throw new DomainError("FORBIDDEN");
    const moved: Record<string, number> = {};
    const updates = [
      ["household_contacts", sql`update household_contacts set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["household_preferences", sql`update household_preferences set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["sms_consents", sql`update sms_consents set household_id=${targetHouseholdId}::uuid where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["appointments", sql`update appointments set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["inventory_reservations", sql`update inventory_reservations set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["pickup_fulfillments", sql`update pickup_fulfillments set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["sms_messages", sql`update sms_messages set household_id=${targetHouseholdId}::uuid,updated_at=now() where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
      ["inbound_messages", sql`update inbound_messages set household_id=${targetHouseholdId}::uuid where organization_id=${organizationId}::uuid and household_id=${sourceHouseholdId}::uuid`],
    ] as const;
    for (const [name, statement] of updates) moved[name] = (await tx.execute(statement)).rowCount ?? 0;
    await tx.update(households).set({ status: "merged", mergedIntoHouseholdId: targetHouseholdId, archivedAt: new Date(), updatedAt: new Date() }).where(eq(households.id, sourceHouseholdId));
    await tx.insert(auditLogs).values({ organizationId, actorUserId: actorId, actorMembershipId: membership[0].id, action: "household.merged", entityType: "household", entityId: sourceHouseholdId, requestId, reason, previousValues: { status: source[0].status }, newValues: { status: "merged", mergedIntoHouseholdId: targetHouseholdId }, metadata: { targetHouseholdId, moved } });
    return { sourceHouseholdId, targetHouseholdId, moved };
  });
}
