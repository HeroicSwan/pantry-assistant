// @vitest-environment node

import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test") || testUrl === developmentUrl) {
  throw new Error("Integration tests require the distinct local *_test database.");
}
// The inventory service resolves its pool from DATABASE_URL; bind it to the isolated test database.
process.env.DATABASE_URL = testUrl;

const pool = new Pool({ connectionString: testUrl, max: 6 });

const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  downtown: "30000000-0000-4000-8000-000000000001",
  northside: "30000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000001",
  suspended: "10000000-0000-4000-8000-000000000006",
  unrelatedAdmin: "10000000-0000-4000-8000-000000000007",
};

const seeded = {
  riceLot: "",
  soupLot: "",
  waterLot: "",
  pastaLot: "",
  riceItem: "",
  poundUnit: "",
  riceOpeningTx: "",
  pastaOpeningTx: "",
};

async function lotId(code: string) {
  const result = await pool.query<{ id: string }>("select id from inventory_lots where lot_code=$1", [code]);
  return result.rows[0]!.id;
}
async function openingTx(lot: string) {
  const result = await pool.query<{ id: string }>("select id from inventory_transactions where inventory_lot_id=$1 and transaction_type='opening_balance'", [lot]);
  return result.rows[0]!.id;
}
async function available(item: string, location: string) {
  const result = await pool.query<{ available_quantity: string }>("select available_quantity::text from inventory_item_location_balances where inventory_item_id=$1 and pantry_location_id=$2", [item, location]);
  return Number(result.rows[0]?.available_quantity ?? "0");
}

describe("inventory ledger foundation", () => {
  beforeAll(async () => {
    const identity = await pool.query("select current_database() as database, current_user as role");
    expect(identity.rows[0]).toMatchObject({ database: "food_pantry_test", role: "pantry_app" });
    seeded.riceLot = await lotId("RICE-2607");
    seeded.soupLot = await lotId("SOUP-2509");
    seeded.waterLot = await lotId("WATER-2607");
    seeded.pastaLot = await lotId("PASTA-2606");
    seeded.riceItem = (await pool.query<{ inventory_item_id: string }>("select inventory_item_id from inventory_lots where id=$1", [seeded.riceLot])).rows[0]!.inventory_item_id;
    seeded.poundUnit = (await pool.query<{ id: string }>("select id from units_of_measure where organization_id=$1 and abbreviation='lb'", [ids.harbor])).rows[0]!.id;
    seeded.riceOpeningTx = await openingTx(seeded.riceLot);
    seeded.pastaOpeningTx = await openingTx(seeded.pastaLot);
  });

  afterAll(async () => pool.end());

  it("keeps posted transactions append-only", async () => {
    await expect(pool.query("update inventory_transactions set reason='tampered' where id=$1", [seeded.riceOpeningTx])).rejects.toMatchObject({ code: "55000", message: "LEDGER_IMMUTABLE" });
    await expect(pool.query("delete from inventory_transactions where id=$1", [seeded.riceOpeningTx])).rejects.toMatchObject({ code: "55000", message: "LEDGER_IMMUTABLE" });
  });

  it("blocks negative stock at the database boundary", async () => {
    await expect(
      pool.query(
        "insert into inventory_transactions (organization_id,pantry_location_id,inventory_item_id,inventory_lot_id,transaction_type,physical_delta,actor_user_id,request_id) values ($1,$2,$3,$4,'manual_negative_adjustment','-1000',$5,gen_random_uuid())",
        [ids.harbor, ids.downtown, seeded.riceItem, seeded.riceLot, ids.admin],
      ),
    ).rejects.toMatchObject({ code: "23514", message: "INSUFFICIENT_STOCK" });
  });

  it("enforces the transaction-type sign", async () => {
    await expect(
      pool.query(
        "insert into inventory_transactions (organization_id,pantry_location_id,inventory_item_id,inventory_lot_id,transaction_type,physical_delta,actor_user_id,request_id) values ($1,$2,$3,$4,'opening_balance','-1',$5,gen_random_uuid())",
        [ids.harbor, ids.downtown, seeded.riceItem, seeded.riceLot, ids.admin],
      ),
    ).rejects.toMatchObject({ code: "23514", message: "TRANSACTION_SIGN_INVALID" });
  });

  it("blocks a transaction whose lot belongs to another location", async () => {
    await expect(
      pool.query(
        "insert into inventory_transactions (organization_id,pantry_location_id,inventory_item_id,inventory_lot_id,transaction_type,physical_delta,actor_user_id,request_id) values ($1,$2,$3,$4,'manual_positive_adjustment','1',$5,gen_random_uuid())",
        [ids.harbor, ids.northside, seeded.riceItem, seeded.riceLot, ids.admin],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("derives balances that exclude expired stock and net reversals", async () => {
    const soup = await pool.query<{ available_quantity: string; expired_quantity: string; physical_on_hand: string }>(
      "select available_quantity::text, expired_quantity::text, physical_on_hand::text from inventory_item_location_balances b join inventory_lots l on l.inventory_item_id=b.inventory_item_id and l.pantry_location_id=b.pantry_location_id where l.id=$1",
      [seeded.soupLot],
    );
    expect(soup.rows[0]!.available_quantity).toBe("0");
    expect(soup.rows[0]!.expired_quantity).toBe(soup.rows[0]!.physical_on_hand);
    expect(Number(soup.rows[0]!.physical_on_hand)).toBeGreaterThan(0);
    // Rice opening +48, adjustment -6, reversal +6 nets to 48 available.
    expect(await available(seeded.riceItem, ids.downtown)).toBe(48);
  });

  it("posts an adjustment through the service with an audit record", async () => {
    const { recordAdjustment } = await import("@/domains/inventory/service");
    const waterItem = (await pool.query<{ inventory_item_id: string }>("select inventory_item_id from inventory_lots where id=$1", [seeded.waterLot])).rows[0]!.inventory_item_id;
    const unit = (await pool.query<{ id: string }>("select id from units_of_measure where organization_id=$1 and abbreviation='ea'", [ids.harbor])).rows[0]!.id;
    const before = await available(waterItem, ids.downtown);
    const posted = await recordAdjustment(ids.admin, ids.harbor, { lotId: seeded.waterLot, direction: "negative", quantity: "8", unitId: unit, reasonCode: "count_correction", reason: "Cycle count correction." }, crypto.randomUUID());
    expect(await available(waterItem, ids.downtown)).toBe(before - 8);
    const audit = await pool.query("select 1 from audit_logs where entity_id=$1 and action='inventory.adjustment_posted'", [posted.id]);
    expect(audit.rowCount).toBe(1);
  });

  it("reverses a posted transaction and blocks double reversal", async () => {
    const { reverseTransaction } = await import("@/domains/inventory/service");
    const pastaItem = (await pool.query<{ inventory_item_id: string }>("select inventory_item_id from inventory_lots where id=$1", [seeded.pastaLot])).rows[0]!.inventory_item_id;
    await reverseTransaction(ids.admin, ids.harbor, seeded.pastaOpeningTx, "Received in error.", crypto.randomUUID());
    expect(await available(pastaItem, ids.downtown)).toBe(0);
    await expect(reverseTransaction(ids.admin, ids.harbor, seeded.pastaOpeningTx, "Retry.", crypto.randomUUID())).rejects.toMatchObject({ message: "ALREADY_REVERSED" });
  });

  it("denies unrelated-organization and suspended actors", async () => {
    const { recordAdjustment } = await import("@/domains/inventory/service");
    const unit = (await pool.query<{ id: string }>("select id from units_of_measure where organization_id=$1 and abbreviation='ea'", [ids.harbor])).rows[0]!.id;
    const payload = { lotId: seeded.riceLot, direction: "negative" as const, quantity: "1", unitId: unit, reasonCode: "count_correction", reason: "Unauthorized attempt." };
    await expect(recordAdjustment(ids.unrelatedAdmin, ids.harbor, payload, crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(recordAdjustment(ids.suspended, ids.harbor, payload, crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
  });

  it("rejects a cross-dimension unit conversion", async () => {
    const { addItemUnit } = await import("@/domains/inventory/service");
    await expect(
      addItemUnit(ids.admin, ids.harbor, { itemId: seeded.riceItem, unitId: seeded.poundUnit, factor: "5", roundingPolicy: "reject" }, crypto.randomUUID()),
    ).rejects.toMatchObject({ message: "UNIT_DIMENSION_MISMATCH" });
  });

  it("serializes concurrent condition removals so stock never goes negative", async () => {
    const { recordConditionRemoval } = await import("@/domains/inventory/operations-service");
    const unit = (await pool.query<{ id: string }>("select id from units_of_measure where organization_id=$1 and abbreviation='ea'", [ids.harbor])).rows[0]!.id;
    const before = await available(seeded.riceItem, ids.downtown);
    const half = Math.floor(before / 2) + 5; // two of these exceed the balance
    const results = await Promise.allSettled([
      recordConditionRemoval(ids.admin, ids.harbor, { eventType: "damage", lotId: seeded.riceLot, quantity: String(half), unitId: unit, reason: "Concurrent A.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID()),
      recordConditionRemoval(ids.admin, ids.harbor, { eventType: "damage", lotId: seeded.riceLot, quantity: String(half), unitId: unit, reason: "Concurrent B.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID()),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ message: "INSUFFICIENT_STOCK" });
    expect(await available(seeded.riceItem, ids.downtown)).toBe(before - half);
  });
});
