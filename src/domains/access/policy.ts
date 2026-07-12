import { z } from "zod";

export const permissionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

export type ScopedAssignment = {
  scope: "organization" | "location";
  locationId: string | null;
  permissions: string[];
};

export function resolveEffectivePermissions(
  assignments: ScopedAssignment[],
  activeLocationId: string | null,
) {
  return new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.scope === "organization" ||
          (activeLocationId !== null &&
            assignment.locationId === activeLocationId),
      )
      .flatMap((assignment) => assignment.permissions),
  );
}

export function roleScopeAllowsLocation(
  scope: "organization" | "location",
  locationId: string | null,
) {
  return scope === "organization" ? locationId === null : locationId !== null;
}

export function canRemoveAdministrator(
  targetIsAdministrator: boolean,
  activeAdministratorCount: number,
) {
  return !targetIsAdministrator || activeAdministratorCount > 1;
}

export function isInvitationExpired(expiresAt: string, now = new Date()) {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function isOperationalMembership(
  status: string,
  archivedAt: string | null,
) {
  return status === "active" && archivedAt === null;
}

export function selectActiveId<T extends { id: string }>(
  items: T[],
  preferredId: string | null | undefined,
) {
  return (
    items.find((item) => item.id === preferredId)?.id ?? items[0]?.id ?? null
  );
}
