// @vitest-environment node

import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test") || testUrl === developmentUrl) throw new Error("Integration tests require the distinct local *_test database.");
process.env.DATABASE_URL = testUrl;

const pool = new Pool({ connectionString: testUrl, max: 4 });
const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  northside: "30000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000001",
  unrelatedAdmin: "10000000-0000-4000-8000-000000000007",
};

describe.sequential("pickup operations", () => {
  afterAll(async () => pool.end());

  beforeAll(async () => {
    const permission = await pool.query("select 1 from permissions where key='pickup.complete'");
    expect(permission.rowCount).toBe(1);
  });

  it("reserves FEFO inventory and posts immutable pickup fulfillment only after check-in", async () => {
    const { addPackageTemplateLine, checkInAppointment, completePickup, createAppointment, createHousehold, createPackageTemplate, createReservation } = await import("@/domains/pickups/service");
    const household = await createHousehold(ids.admin, ids.harbor, { displayName: `Pickup integration ${crypto.randomUUID().slice(0, 8)}`, householdSize: 2, defaultPantryLocationId: ids.northside }, crypto.randomUUID());
    const template = await createPackageTemplate(ids.admin, ids.harbor, { name: `Integration package ${crypto.randomUUID().slice(0, 8)}`, packageType: "integration", allowSubstitutions: false }, crypto.randomUUID());
    const rice = (await pool.query<{ id: string }>("select id from inventory_items where organization_id=$1 and name='Rice (5 lb bag)'", [ids.harbor])).rows[0]!.id;
    await addPackageTemplateLine(ids.admin, ids.harbor, template.id, { lineType: "exact_item", inventoryItemId: rice, baseQuantity: "2", isRequired: true, allowSubstitution: false, priority: 1 }, crypto.randomUUID());
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const created = await createAppointment(ids.admin, ids.harbor, { householdId: household.id, pantryLocationId: ids.northside, appointmentType: "scheduled_pickup", scheduledStartAt: start, scheduledEndAt: end, packageTemplateId: template.id, generateAllocation: true, reserve: false }, crypto.randomUUID());
    const reservationResult = await createReservation(ids.admin, ids.harbor, created.appointment.id, { idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect(reservationResult.reservation).not.toBeNull();
    const allocation = (await pool.query<{ reservation_line_id: string; inventory_lot_id: string }>("select rl.id as reservation_line_id, la.inventory_lot_id from inventory_reservation_lines rl join inventory_reservation_lot_allocations la on la.reservation_line_id=rl.id where rl.reservation_id=$1", [reservationResult.reservation!.id])).rows[0]!;
    const before = (await pool.query<{ physical_on_hand: string; available_quantity: string }>("select physical_on_hand::text, available_quantity::text from inventory_lot_balances where inventory_lot_id=$1", [allocation.inventory_lot_id])).rows[0]!;
    expect(Number(before.available_quantity)).toBeLessThan(Number(before.physical_on_hand));
    await expect(completePickup(ids.admin, ids.harbor, created.appointment.id, { lines: [], idempotencyKey: crypto.randomUUID() }, crypto.randomUUID())).rejects.toMatchObject({ message: "APPOINTMENT_INVALID_STATE" });
    await checkInAppointment(ids.admin, ids.harbor, created.appointment.id, crypto.randomUUID());
    const completed = await completePickup(ids.admin, ids.harbor, created.appointment.id, { lines: [{ reservationLineId: allocation.reservation_line_id, inventoryLotId: allocation.inventory_lot_id, quantity: 2 }], idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect(completed.fulfillment.status).toBe("completed");
    const after = (await pool.query<{ physical_on_hand: string; available_quantity: string }>("select physical_on_hand::text, available_quantity::text from inventory_lot_balances where inventory_lot_id=$1", [allocation.inventory_lot_id])).rows[0]!;
    expect(Number(after.physical_on_hand)).toBe(Number(before.physical_on_hand) - 2);
    await expect(pool.query("update pickup_fulfillments set notes='tampered' where id=$1", [completed.fulfillment.id])).rejects.toMatchObject({ message: "FULFILLMENT_IMMUTABLE" });
  });

  it("blocks cross-organization pickup reads and writes", async () => {
    const { createHousehold } = await import("@/domains/pickups/service");
    await expect(createHousehold(ids.unrelatedAdmin, ids.harbor, { displayName: "Blocked household", householdSize: 1 }, crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});
