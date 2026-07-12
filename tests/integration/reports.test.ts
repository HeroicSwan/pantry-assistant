// @vitest-environment node
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { ReportFilters } from "@/domains/reports/policy";

config({ path: ".env.local", quiet: true });
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test") || testUrl === developmentUrl) throw new Error("Integration tests require the distinct local *_test database.");
process.env.DATABASE_URL = testUrl;

const pool = new Pool({ connectionString: testUrl, max: 3 });
const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  downtown: "30000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000001",
  unrelated: "10000000-0000-4000-8000-000000000007",
};
const filters: ReportFilters = {
  dateFrom: "2025-07-12",
  dateTo: "2026-07-11",
  page: 1,
  perPage: 50,
  range: undefined,
  itemId: undefined,
  categoryId: undefined,
  donorId: undefined,
  householdId: undefined,
  appointmentStatus: undefined,
  transactionType: undefined,
  alertType: undefined,
  messageStatus: undefined,
  forecastConfidence: undefined,
  transferStatus: undefined,
};

describe.sequential("reports and exports", () => {
  afterAll(async () => pool.end());

  it("executes every canonical report with location scope", async () => {
    const { getAuthorizedReport } = await import("@/domains/reports/service");
    const { reportTypes } = await import("@/domains/reports/policy");
    for (const reportType of reportTypes) {
      const result = await getAuthorizedReport({ actorUserId: ids.admin, organizationSlug: "harbor-community-food-pantry", locationId: ids.downtown, reportType, filters });
      expect(result.scope.organizationId).toBe(ids.harbor);
      expect(result.scope.locationId).toBe(ids.downtown);
      expect(Array.isArray(result.data.rows)).toBe(true);
    }
  });

  it("blocks a user from another organization even when identifiers are known", async () => {
    const { getAuthorizedReport } = await import("@/domains/reports/service");
    await expect(getAuthorizedReport({ actorUserId: ids.unrelated, organizationSlug: "harbor-community-food-pantry", locationId: ids.downtown, reportType: "inventory-on-hand", filters })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records an append-only export audit and immutable report export", async () => {
    const { getAuthorizedReport, recordReportExport } = await import("@/domains/reports/service");
    const result = await getAuthorizedReport({ actorUserId: ids.admin, organizationSlug: "harbor-community-food-pantry", locationId: ids.downtown, reportType: "inventory-on-hand", filters, mode: "export" });
    const requestId = crypto.randomUUID();
    const exported = await recordReportExport({ actorUserId: ids.admin, scope: result.scope, reportType: "inventory-on-hand", filters, rowCount: result.data.rows.length, requestId });
    const audit = await pool.query("select 1 from audit_logs where action='report.exported' and entity_id=$1 and request_id=$2", [exported.id, requestId]);
    expect(audit.rowCount).toBe(1);
    await expect(pool.query("update report_exports set row_count=999 where id=$1", [exported.id])).rejects.toMatchObject({ message: "APPEND_ONLY_RECORD" });
  });
});
