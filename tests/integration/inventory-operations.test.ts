// @vitest-environment node

import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!developmentUrl || !testUrl) throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed = new URL(testUrl);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test') || testUrl === developmentUrl) throw new Error("Integration tests require the distinct local *_test database.");
process.env.DATABASE_URL = testUrl;

const pool = new Pool({ connectionString: testUrl, max: 6 });
const ids = {
  harbor: "20000000-0000-4000-8000-000000000001",
  downtown: "30000000-0000-4000-8000-000000000001",
  northside: "30000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000002",
  worker: "10000000-0000-4000-8000-000000000003",
  unrelatedAdmin: "10000000-0000-4000-8000-000000000007",
};

let eachUnit = "";
let riceItem = "";
let receivedLot = "";
let purchaseTransaction = "";

describe.sequential("inventory operations", () => {
  beforeAll(async () => {
    eachUnit = (await pool.query<{ id: string }>("select id from units_of_measure where organization_id=$1 and abbreviation='ea'", [ids.harbor])).rows[0]!.id;
    const rice = await pool.query<{ id: string; inventory_item_id: string }>("select id, inventory_item_id from inventory_lots where lot_code='RICE-N-2607'");
    riceItem = rice.rows[0]!.inventory_item_id;
  });

  afterAll(async () => pool.end());

  it("completes multi-line receiving atomically and idempotently", async () => {
    const { addReceivingLine, completeReceiving, startReceiving } = await import("@/domains/inventory/operations-service");
    const beans = (await pool.query<{ id: string }>("select id from inventory_items where organization_id=$1 and name='Canned black beans'", [ids.harbor])).rows[0]!.id;
    const key = crypto.randomUUID();
    const session = await startReceiving(ids.admin, ids.harbor, ids.northside, { sourceType: "other", idempotencyKey: key, notes: "Integration receipt." }, crypto.randomUUID());
    const retry = await startReceiving(ids.admin, ids.harbor, ids.northside, { sourceType: "other", idempotencyKey: key }, crypto.randomUUID());
    expect(retry.id).toBe(session.id);
    await addReceivingLine(ids.admin, ids.harbor, session.id, { itemId: riceItem, quantity: "3", unitId: eachUnit, lotNumber: "OPS-RICE", receivedDate: "2026-07-11" }, crypto.randomUUID());
    await addReceivingLine(ids.admin, ids.harbor, session.id, { itemId: beans, quantity: "4", unitId: eachUnit, lotNumber: "OPS-BEANS", receivedDate: "2026-07-11" }, crypto.randomUUID());
    await completeReceiving(ids.admin, ids.harbor, session.id, crypto.randomUUID());
    await completeReceiving(ids.admin, ids.harbor, session.id, crypto.randomUUID());
    const result = await pool.query<{ count: string }>("select count(*)::text as count from inventory_transactions where source_type='receiving_other' and source_reference_id in (select id from receiving_lines where receiving_session_id=$1)", [session.id]);
    expect(result.rows[0]!.count).toBe("2");
    receivedLot = (await pool.query<{ id: string }>("select id from inventory_lots where lot_code='OPS-RICE'", [])).rows[0]!.id;
  });

  it("receives a purchased shipment and posts purchase ledger entries", async () => {
    const { addReceivingLine, completeReceiving, createPurchasedShipment, startReceiving } = await import("@/domains/inventory/operations-service");
    const water = (await pool.query<{ id: string }>("select id from inventory_items where organization_id=$1 and name='Bottled water (16 oz)'", [ids.harbor])).rows[0]!.id;
    const shipment = await createPurchasedShipment(ids.admin, ids.harbor, ids.downtown, { supplierName: "Integration Supplier", supplierReference: crypto.randomUUID() }, crypto.randomUUID());
    const session = await startReceiving(ids.admin, ids.harbor, ids.downtown, { sourceType: "purchase", purchasedShipmentId: shipment.id, idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    await addReceivingLine(ids.admin, ids.harbor, session.id, { itemId: water, quantity: "2", unitId: eachUnit, lotNumber: "OPS-PURCHASE", receivedDate: "2026-07-11" }, crypto.randomUUID());
    await completeReceiving(ids.admin, ids.harbor, session.id, crypto.randomUUID());
    const transaction = await pool.query<{ id: string }>("select id from inventory_transactions where transaction_type='purchase_received' and source_reference_id in (select id from receiving_lines where receiving_session_id=$1)", [session.id]);
    expect(transaction.rowCount).toBe(1);
    purchaseTransaction = transaction.rows[0]!.id;
    expect((await pool.query<{ status: string }>("select status from purchased_shipments where id=$1", [shipment.id])).rows[0]!.status).toBe("received");
  });

  it("requires a distinct approver for a high-risk adjustment", async () => {
    const { approveAdjustment, submitAdjustment } = await import("@/domains/inventory/operations-service");
    const beansLot = (await pool.query<{ id: string }>("select id from inventory_lots where lot_code='BEAN-2606'")).rows[0]!.id;
    const submitted = await submitAdjustment(ids.worker, ids.harbor, { lotId: beansLot, direction: "negative", quantity: "25", unitId: eachUnit, reasonCode: "count_variance", reason: "Integration high-risk variance.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect(submitted.request.risk).toBe("high");
    expect(submitted.transaction).toBeNull();
    await expect(approveAdjustment(ids.worker, ids.harbor, submitted.request.id, "Self approval.", crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
    const approved = await approveAdjustment(ids.admin, ids.harbor, submitted.request.id, "Verified by administrator.", crypto.randomUUID());
    expect(approved.request.status).toBe("posted");
    expect(approved.transaction.physicalDelta).toBe("-25.000000");

    const selfRequested = await submitAdjustment(ids.admin, ids.harbor, { lotId: beansLot, direction: "positive", quantity: "25", unitId: eachUnit, reasonCode: "count_variance", reason: "Self-approval test.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    await expect(approveAdjustment(ids.admin, ids.harbor, selfRequested.request.id, "Self approval.", crypto.randomUUID())).rejects.toMatchObject({ message: "SELF_APPROVAL_FORBIDDEN" });
  });

  it("corrects a posted receipt with an immutable reversal and replacement chain", async () => {
    const { correctTransaction } = await import("@/domains/inventory/operations-service");
    const result = await correctTransaction(ids.admin, ids.harbor, purchaseTransaction, { direction: "positive", quantity: "1", unitId: eachUnit, reasonCode: "receiving_correction", reason: "One unit was received, not two." }, crypto.randomUUID());
    expect(result.reversal.reversesTransactionId).toBe(purchaseTransaction);
    expect(result.replacement.correlationId).toBe(result.reversal.correlationId);
    await expect(pool.query("update inventory_transactions set reason='rewrite' where id=$1", [result.replacement.id])).rejects.toMatchObject({ message: "LEDGER_IMMUTABLE" });
  });

  it("places and releases status-only quarantine holds without changing physical stock", async () => {
    const { placeQuarantine, releaseQuarantine } = await import("@/domains/inventory/operations-service");
    const before = (await pool.query<{ physical: string; available: string }>("select physical_on_hand::text as physical, available_quantity::text as available from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!;
    await placeQuarantine(ids.admin, ids.harbor, receivedLot, "Inspect packaging.", crypto.randomUUID(), crypto.randomUUID());
    const held = (await pool.query<{ physical: string; available: string }>("select physical_on_hand::text as physical, available_quantity::text as available from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!;
    expect(held.physical).toBe(before.physical);
    expect(Number(held.available)).toBe(0);
    await releaseQuarantine(ids.admin, ids.harbor, receivedLot, "Packaging cleared.", crypto.randomUUID(), crypto.randomUUID());
    const released = (await pool.query<{ available: string }>("select available_quantity::text as available from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!;
    expect(released.available).toBe(before.available);
  });

  it("handles expiration removal and recall holds without conflating physical and available stock", async () => {
    const { createRecall, recordConditionRemoval, resolveRecall } = await import("@/domains/inventory/operations-service");
    const soup = (await pool.query<{ id: string }>("select id from inventory_lots where lot_code='SOUP-2509'", [])).rows[0]!.id;
    const removal = await recordConditionRemoval(ids.admin, ids.harbor, { eventType: "expiration_removal", lotId: soup, quantity: "1", unitId: eachUnit, reason: "Expired unit removed.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect(removal.eventType).toBe("expiration_removal");
    const before = (await pool.query<{ physical: string }>("select physical_on_hand::text as physical from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!.physical;
    const recall = await createRecall(ids.admin, ids.harbor, { referenceCode: `RCL-${crypto.randomUUID().slice(0, 8)}`, title: "Integration recall", description: "Hold for review.", lotIds: [receivedLot] }, crypto.randomUUID());
    const held = (await pool.query<{ physical: string; available: string }>("select physical_on_hand::text as physical, available_quantity::text as available from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!;
    expect(held.physical).toBe(before);
    expect(Number(held.available)).toBe(0);
    await resolveRecall(ids.admin, ids.harbor, recall.id, "Cleared by fictional supplier.", crypto.randomUUID());
    expect(Number((await pool.query<{ available: string }>("select available_quantity::text as available from inventory_lot_balances where inventory_lot_id=$1", [receivedLot])).rows[0]!.available)).toBeGreaterThan(0);
  });

  it("marks stale count snapshots and completes a clean reconciliation", async () => {
    const { approveCycleCount, reconcileCycleCount, recordConditionRemoval, startCycleCount, submitCycleCount } = await import("@/domains/inventory/operations-service");
    const stale = await startCycleCount(ids.admin, ids.harbor, ids.downtown, "Stale count test.", crypto.randomUUID(), crypto.randomUUID());
    await pool.query("update cycle_count_entries set counted_quantity=snapshot_quantity, normalized_counted_quantity=snapshot_quantity, variance_quantity=0, counted_by=$2, counted_at=now() where count_session_id=$1", [stale.id, ids.admin]);
    await submitCycleCount(ids.admin, ids.harbor, stale.id, crypto.randomUUID());
    await approveCycleCount(ids.manager, ids.harbor, stale.id, crypto.randomUUID());
    const waterLot = (await pool.query<{ id: string }>("select id from inventory_lots where lot_code='WATER-2607'", [])).rows[0]!.id;
    await recordConditionRemoval(ids.admin, ids.harbor, { eventType: "damage", lotId: waterLot, quantity: "1", unitId: eachUnit, reason: "Post-snapshot damage.", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect((await reconcileCycleCount(ids.manager, ids.harbor, stale.id, crypto.randomUUID())).stale).toBe(true);

    const clean = await startCycleCount(ids.admin, ids.harbor, ids.downtown, "Clean count test.", crypto.randomUUID(), crypto.randomUUID());
    await pool.query("update cycle_count_entries set counted_quantity=snapshot_quantity, normalized_counted_quantity=snapshot_quantity, variance_quantity=0, counted_by=$2, counted_at=now() where count_session_id=$1", [clean.id, ids.admin]);
    await submitCycleCount(ids.admin, ids.harbor, clean.id, crypto.randomUUID());
    await approveCycleCount(ids.manager, ids.harbor, clean.id, crypto.randomUUID());
    const reconciled = await reconcileCycleCount(ids.manager, ids.harbor, clean.id, crypto.randomUUID());
    expect(reconciled.session.status).toBe("reconciled");
  });

  it("dispatches and partially receives a transfer with a derived in-transit balance", async () => {
    const { approveTransfer, createTransfer, dispatchTransfer, receiveTransferLine, requestTransfer } = await import("@/domains/inventory/operations-service");
    const transfer = await createTransfer(ids.manager, ids.harbor, { transferNumber: `TR-OPS-${crypto.randomUUID().slice(0, 8)}`, sourceLocationId: ids.downtown, destinationLocationId: ids.northside, idempotencyKey: crypto.randomUUID(), lines: [{ lotId: (await pool.query<{ id: string }>("select id from inventory_lots where lot_code='BEAN-2606'")).rows[0]!.id, quantity: "2", unitId: eachUnit }] }, crypto.randomUUID());
    await requestTransfer(ids.manager, ids.harbor, transfer.id, crypto.randomUUID());
    await approveTransfer(ids.admin, ids.harbor, transfer.id, crypto.randomUUID());
    await dispatchTransfer(ids.manager, ids.harbor, transfer.id, crypto.randomUUID());
    await expect(dispatchTransfer(ids.manager, ids.harbor, transfer.id, crypto.randomUUID())).rejects.toMatchObject({ message: "INVALID_TRANSFER_STATE" });
    const line = (await pool.query<{ id: string }>("select id from inventory_transfer_lines where transfer_id=$1", [transfer.id])).rows[0]!;
    const receiptKey = crypto.randomUUID();
    const firstReceipt = await receiveTransferLine(ids.admin, ids.harbor, transfer.id, line.id, { quantity: "1", unitId: eachUnit, idempotencyKey: receiptKey }, crypto.randomUUID());
    const receiptRetry = await receiveTransferLine(ids.admin, ids.harbor, transfer.id, line.id, { quantity: "1", unitId: eachUnit, idempotencyKey: receiptKey }, crypto.randomUUID());
    expect(receiptRetry.id).toBe(firstReceipt.id);
    const transit = await pool.query<{ in_transit_quantity: string }>("select in_transit_quantity::text from inventory_in_transit_balances where transfer_id=$1", [transfer.id]);
    expect(transit.rows[0]!.in_transit_quantity).toBe("1.000000");
    await receiveTransferLine(ids.admin, ids.harbor, transfer.id, line.id, { quantity: "1", unitId: eachUnit, idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    expect((await pool.query("select 1 from inventory_in_transit_balances where transfer_id=$1", [transfer.id])).rowCount).toBe(0);
  });

  it("blocks cross-organization operational references", async () => {
    const { placeQuarantine, startReceiving } = await import("@/domains/inventory/operations-service");
    await expect(placeQuarantine(ids.unrelatedAdmin, ids.harbor, receivedLot, "Cross-org attempt.", crypto.randomUUID(), crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(startReceiving(ids.unrelatedAdmin, ids.harbor, ids.northside, { sourceType: "other", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
    await expect(startReceiving(ids.worker, ids.harbor, ids.northside, { sourceType: "other", idempotencyKey: crypto.randomUUID() }, crypto.randomUUID())).rejects.toMatchObject({ message: "FORBIDDEN" });
  });

  it("keeps condition events and transfer receipts append-only", async () => {
    const event = await pool.query<{ id: string }>("select id from inventory_condition_events order by created_at desc limit 1");
    await expect(pool.query("update inventory_condition_events set reason='tampered' where id=$1", [event.rows[0]!.id])).rejects.toMatchObject({ code: "55000", message: "OPERATION_RECORD_IMMUTABLE" });
    const receipt = await pool.query<{ id: string }>("select id from inventory_transfer_receipts order by received_at desc limit 1");
    await expect(pool.query("delete from inventory_transfer_receipts where id=$1", [receipt.rows[0]!.id])).rejects.toMatchObject({ code: "55000", message: "OPERATION_RECORD_IMMUTABLE" });
  });
});
