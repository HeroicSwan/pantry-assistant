// @vitest-environment node

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  hasLocationPermission,
  hasOrganizationPermission,
} from "@/lib/database/authorization";
import * as schema from "@/lib/database/schema";

config({ path: ".env.local", quiet: true });

const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const password = process.env.SEED_USER_PASSWORD;
if (!developmentUrl || !testUrl || !password)
  throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test") ||
  testUrl === developmentUrl
) {
  throw new Error(
    "Integration tests require the distinct local *_test database.",
  );
}

const pool = new Pool({ connectionString: testUrl, max: 4 });
const database = drizzle(pool, { schema });
const testAuth = betterAuth({
  database: drizzleAdapter(database, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: "http://localhost:3000",
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  advanced: { database: { generateId: "uuid" } },
});

const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  unrelatedOrganization: "20000000-0000-4000-8000-000000000002",
  downtown: "30000000-0000-4000-8000-000000000001",
  northside: "30000000-0000-4000-8000-000000000002",
  unrelatedLocation: "30000000-0000-4000-8000-000000000003",
  admin: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000002",
  volunteer: "10000000-0000-4000-8000-000000000004",
  suspended: "10000000-0000-4000-8000-000000000006",
  unrelatedAdmin: "10000000-0000-4000-8000-000000000007",
};

describe("native PostgreSQL identity foundation", () => {
  beforeAll(async () => {
    const result = await pool.query(
      "select current_database() as database, current_user as role",
    );
    expect(result.rows[0]).toMatchObject({
      database: "food_pantry_test",
      role: "pantry_app",
    });
  });

  afterAll(async () => pool.end());

  it("authenticates a seeded user and rejects invalid credentials", async () => {
    const signedIn = await testAuth.api.signInEmail({
      body: { email: "admin@harbor-pantry.example.test", password },
    });
    expect(signedIn.user.email).toBe("admin@harbor-pantry.example.test");
    await expect(
      testAuth.api.signInEmail({
        body: {
          email: "admin@harbor-pantry.example.test",
          password: `${password}wrong`,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("enforces organization, location, suspension, and unrelated-organization scope", async () => {
    await expect(
      hasOrganizationPermission(database, ids.admin, ids.harbor, "role.assign"),
    ).resolves.toBe(true);
    await expect(
      hasLocationPermission(
        database,
        ids.volunteer,
        ids.northside,
        "appointment.check_in",
      ),
    ).resolves.toBe(true);
    await expect(
      hasLocationPermission(
        database,
        ids.volunteer,
        ids.downtown,
        "appointment.check_in",
      ),
    ).resolves.toBe(false);
    await expect(
      hasLocationPermission(
        database,
        ids.suspended,
        ids.downtown,
        "location.view",
      ),
    ).resolves.toBe(false);
    await expect(
      hasOrganizationPermission(
        database,
        ids.unrelatedAdmin,
        ids.harbor,
        "organization.view",
      ),
    ).resolves.toBe(false);
    await expect(
      hasLocationPermission(
        database,
        ids.admin,
        ids.unrelatedLocation,
        "location.view",
      ),
    ).resolves.toBe(false);
  });

  it("rolls back an interrupted transaction", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into organizations (name,slug,timezone,created_by) values ('Rollback Pantry','rollback-pantry','UTC',$1)",
        [ids.admin],
      );
      await client.query("rollback");
      const result = await client.query(
        "select 1 from organizations where slug='rollback-pantry'",
      );
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("creates a location through the server service with an audit record", async () => {
    process.env.DATABASE_URL = testUrl;
    const { createLocation } = await import("@/domains/admin/service");
    const slug = `service-created-${crypto.randomUUID()}`;
    const created = await createLocation(
      ids.admin,
      ids.harbor,
      {
        name: "Service-created Pantry",
        slug,
        status: "active",
        timezone: "America/New_York",
        email: "",
        phoneNumber: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        countryCode: "US",
        operatingNotes: "",
      },
      crypto.randomUUID(),
    );
    expect(created.slug).toBe(slug);
    const audit = await pool.query(
      "select 1 from audit_logs where entity_id=$1 and action='location.created'",
      [created.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("prevents a delegated role assigner from granting or removing Administrator", async () => {
    process.env.DATABASE_URL = testUrl;
    const delegatedRoleId = crypto.randomUUID();
    const delegatedRoleSlug = `delegated-assignment-${delegatedRoleId}`;
    const [volunteerMembership] = (
      await pool.query(
        "select id from organization_memberships where organization_id=$1 and user_id=$2",
        [ids.harbor, ids.volunteer],
      )
    ).rows;
    await pool.query(
      "insert into roles (id,organization_id,name,slug,description,scope,is_system_role,is_editable,created_by) values ($1,$2,'Delegated assignment',$3,'Regression role','organization',false,true,$4)",
      [delegatedRoleId, ids.harbor, delegatedRoleSlug, ids.admin],
    );
    await pool.query(
      "insert into role_permissions (role_id,permission_id) select $1,id from permissions where key='role.assign'",
      [delegatedRoleId],
    );
    await pool.query(
      "insert into membership_roles (organization_membership_id,role_id,assigned_by) values ($1,$2,$3)",
      [volunteerMembership.id, delegatedRoleId, ids.admin],
    );
    const { assignMemberRole, removeMemberRole } =
      await import("@/domains/admin/service");
    await expect(
      assignMemberRole(
        ids.volunteer,
        ids.harbor,
        volunteerMembership.id,
        "00000000-0000-4000-8000-000000000001",
        null,
        null,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    const adminAssignment = (
      await pool.query(
        "select mr.id from membership_roles mr join organization_memberships om on om.id=mr.organization_membership_id where om.organization_id=$1 and mr.role_id='00000000-0000-4000-8000-000000000001' and mr.archived_at is null limit 1",
        [ids.harbor],
      )
    ).rows[0];
    await expect(
      removeMemberRole(
        ids.volunteer,
        ids.harbor,
        adminAssignment.id,
        "Regression attempt",
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    const administratorAssignment = await assignMemberRole(
      ids.admin,
      ids.harbor,
      volunteerMembership.id,
      "00000000-0000-4000-8000-000000000001",
      null,
      null,
      crypto.randomUUID(),
    );
    expect(administratorAssignment).toMatchObject({
      roleId: "00000000-0000-4000-8000-000000000001",
    });
    await expect(
      removeMemberRole(
        ids.admin,
        ids.harbor,
        administratorAssignment.id,
        "Regression cleanup",
        crypto.randomUUID(),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid attachment scope before any filesystem write", async () => {
    process.env.DATABASE_URL = testUrl;
    const { storeAttachment } = await import("@/domains/attachments/service");
    const escapedDirectory = path.join(
      process.cwd(),
      "data",
      `attachment-regression-${crypto.randomUUID()}`,
    );
    await expect(
      storeAttachment({
        actorId: ids.admin,
        organizationId: `../../attachment-regression-${path.basename(escapedDirectory)}`,
        locationId: ids.downtown,
        entityType: "inventory_item",
        entityId: crypto.randomUUID(),
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      }),
    ).rejects.toMatchObject({ message: "VALIDATION_ERROR" });
    expect(existsSync(escapedDirectory)).toBe(false);
  });

  it("keeps a location-scoped manager within the household's assigned location", async () => {
    process.env.DATABASE_URL = testUrl;
    const household = (
      await pool.query(
        "select id,display_name,preferred_language,household_size,adult_count,child_count,senior_count,default_pantry_location_id,operational_notes,external_reference from households where organization_id=$1 and default_pantry_location_id=$2 limit 1",
        [ids.harbor, ids.downtown],
      )
    ).rows[0];
    const { updateHousehold } = await import("@/domains/pickups/service");
    const values = {
      displayName: household.display_name,
      preferredLanguage: household.preferred_language,
      householdSize: household.household_size,
      adultCount: household.adult_count,
      childCount: household.child_count,
      seniorCount: household.senior_count,
      operationalNotes: household.operational_notes,
      externalReference: household.external_reference,
    };
    await expect(
      updateHousehold(
        ids.manager,
        ids.harbor,
        household.id,
        { ...values, defaultPantryLocationId: ids.northside },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(
      updateHousehold(
        ids.manager,
        ids.harbor,
        household.id,
        { ...values, defaultPantryLocationId: ids.downtown },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ id: household.id });
  });

  it("blocks cross-organization foreign keys and duplicate slugs", async () => {
    await expect(
      pool.query(
        `insert into location_memberships (organization_membership_id,organization_id,location_id,status,created_by) values ((select id from organization_memberships where user_id=$1),$2,$3,'active',$1)`,
        [ids.volunteer, ids.harbor, ids.unrelatedLocation],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool.query(
        `insert into organizations (name,slug,timezone,created_by) values ('Duplicate','harbor-community-food-pantry','UTC',$1)`,
        [ids.admin],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("protects the final administrator at the database boundary", async () => {
    await expect(
      pool.query(
        "update organization_memberships set status='suspended' where organization_id=$1 and user_id=$2",
        [ids.harbor, ids.admin],
      ),
    ).rejects.toMatchObject({ code: "23514", message: "FINAL_ADMINISTRATOR" });
  });

  it("keeps audit records append-only", async () => {
    const audit = await pool.query(
      "select id from audit_logs where organization_id=$1 limit 1",
      [ids.harbor],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    await expect(
      pool.query("update audit_logs set reason='tampered' where id=$1", [
        audit.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "AUDIT_IMMUTABLE" });
    await expect(
      pool.query("delete from audit_logs where id=$1", [audit.rows[0].id]),
    ).rejects.toMatchObject({ code: "55000", message: "AUDIT_IMMUTABLE" });
  });
});
