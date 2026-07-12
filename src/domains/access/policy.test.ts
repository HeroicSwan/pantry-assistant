import { describe, expect, it } from "vitest";
import {
  canRemoveAdministrator,
  isInvitationExpired,
  isOperationalMembership,
  permissionKeySchema,
  resolveEffectivePermissions,
  roleScopeAllowsLocation,
  selectActiveId,
} from "@/domains/access/policy";

describe("access policy helpers", () => {
  it("validates namespaced permission keys", () => {
    expect(permissionKeySchema.safeParse("location.create").success).toBe(true);
    expect(permissionKeySchema.safeParse("Administrator").success).toBe(false);
  });

  it("resolves organization and selected-location permissions only", () => {
    const permissions = resolveEffectivePermissions(
      [
        {
          scope: "organization",
          locationId: null,
          permissions: ["organization.view"],
        },
        {
          scope: "location",
          locationId: "east",
          permissions: ["inventory.receive"],
        },
        {
          scope: "location",
          locationId: "west",
          permissions: ["inventory.adjust"],
        },
      ],
      "east",
    );
    expect([...permissions]).toEqual([
      "organization.view",
      "inventory.receive",
    ]);
  });

  it("enforces role scope and final-administrator safety", () => {
    expect(roleScopeAllowsLocation("organization", null)).toBe(true);
    expect(roleScopeAllowsLocation("location", null)).toBe(false);
    expect(canRemoveAdministrator(true, 1)).toBe(false);
    expect(canRemoveAdministrator(true, 2)).toBe(true);
  });

  it("handles invitation expiry, membership state, and safe scope fallback", () => {
    expect(
      isInvitationExpired(
        "2026-07-10T00:00:00Z",
        new Date("2026-07-11T00:00:00Z"),
      ),
    ).toBe(true);
    expect(isOperationalMembership("suspended", null)).toBe(false);
    expect(selectActiveId([{ id: "east" }, { id: "west" }], "missing")).toBe(
      "east",
    );
    expect(selectActiveId([], null)).toBeNull();
  });
});
