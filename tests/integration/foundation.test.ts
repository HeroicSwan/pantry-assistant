// @vitest-environment node

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import * as schema from "@/lib/database/schema";

config({ path: ".env.local", quiet: true });

const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const password = process.env.SEED_USER_PASSWORD;
if (!developmentUrl || !testUrl || !password) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test") || testUrl === developmentUrl) {
  throw new Error("Integration tests require the distinct local *_test database.");
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
  volunteer: "10000000-0000-4000-8000-000000000004",
  suspended: "10000000-0000-4000-8000-000000000006",
  unrelatedAdmin: "10000000-0000-4000-8000-000000000007",
};

describe("native PostgreSQL identity foundation", () => {
  beforeAll(async () => {
    const result = await pool.query("select current_database() as database, current_user as role");
    expect(result.rows[0]).toMatchObject({ database: "food_pantry_test", role: "pantry_app" });
  });

  afterAll(async () => pool.end());

  it("authenticates a seeded user and rejects invalid credentials", async () => {
    const signedIn = await testAuth.api.signInEmail({ body: { email: "admin@harbor-pantry.example.test", password } });
    expect(signedIn.user.email).toBe("admin@harbor-pantry.example.test");
    await expect(testAuth.api.signInEmail({ body: { email: "admin@harbor-pantry.example.test", password: `${password}wrong` } })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("enforces organization, location, suspension, and unrelated-organization scope", async () => {
    await expect(hasOrganizationPermission(database, ids.admin, ids.harbor, "role.assign")).resolves.toBe(true);
    await expect(hasLocationPermission(database, ids.volunteer, ids.northside, "appointment.check_in")).resolves.toBe(true);
    await expect(hasLocationPermission(database, ids.volunteer, ids.downtown, "appointment.check_in")).resolves.toBe(false);
    await expect(hasLocationPermission(database, ids.suspended, ids.downtown, "location.view")).resolves.toBe(false);
    await expect(hasOrganizationPermission(database, ids.unrelatedAdmin, ids.harbor, "organization.view")).resolves.toBe(false);
    await expect(hasLocationPermission(database, ids.admin, ids.unrelatedLocation, "location.view")).resolves.toBe(false);
  });

  it("rolls back an interrupted transaction", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("insert into organizations (name,slug,timezone,created_by) values ('Rollback Pantry','rollback-pantry','UTC',$1)", [ids.admin]);
      await client.query("rollback");
      const result = await client.query("select 1 from organizations where slug='rollback-pantry'");
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("creates a location through the server service with an audit record", async () => {
    process.env.DATABASE_URL = testUrl;
    const { createLocation } = await import("@/domains/admin/service");
    const slug = `service-created-${crypto.randomUUID()}`;
    const created = await createLocation(ids.admin, ids.harbor, {
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
    }, crypto.randomUUID());
    expect(created.slug).toBe(slug);
    const audit = await pool.query("select 1 from audit_logs where entity_id=$1 and action='location.created'", [created.id]);
    expect(audit.rowCount).toBe(1);
  });

  it("blocks cross-organization foreign keys and duplicate slugs", async () => {
    await expect(pool.query(`insert into location_memberships (organization_membership_id,organization_id,location_id,status,created_by) values ((select id from organization_memberships where user_id=$1),$2,$3,'active',$1)`, [ids.volunteer, ids.harbor, ids.unrelatedLocation])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(`insert into organizations (name,slug,timezone,created_by) values ('Duplicate','harbor-community-food-pantry','UTC',$1)`, [ids.admin])).rejects.toMatchObject({ code: "23505" });
  });

  it("protects the final administrator at the database boundary", async () => {
    await expect(pool.query("update organization_memberships set status='suspended' where organization_id=$1 and user_id=$2", [ids.harbor, ids.admin])).rejects.toMatchObject({ code: "23514", message: "FINAL_ADMINISTRATOR" });
  });

  it("keeps audit records append-only", async () => {
    const audit = await pool.query("select id from audit_logs where organization_id=$1 limit 1", [ids.harbor]);
    expect(audit.rowCount).toBeGreaterThan(0);
    await expect(pool.query("update audit_logs set reason='tampered' where id=$1", [audit.rows[0].id])).rejects.toMatchObject({ code: "55000", message: "AUDIT_IMMUTABLE" });
    await expect(pool.query("delete from audit_logs where id=$1", [audit.rows[0].id])).rejects.toMatchObject({ code: "55000", message: "AUDIT_IMMUTABLE" });
  });
});
