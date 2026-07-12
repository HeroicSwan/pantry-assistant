import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PermissionGate } from "@/components/auth/permission-gate";
import type { PermissionKey } from "@/lib/auth/access";

describe("PermissionGate", () => {
  it("hides controls without treating the gate as authorization", () => {
    const permissions = new Set<PermissionKey>(["location.view"]);
    render(
      <PermissionGate permissions={permissions} permission="location.create">
        <button>Create location</button>
      </PermissionGate>,
    );
    expect(
      screen.queryByRole("button", { name: "Create location" }),
    ).not.toBeInTheDocument();
  });
});
