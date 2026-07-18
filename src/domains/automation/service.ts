import "server-only";

import { createPurchasedShipment, recordConditionRemoval, createTransfer, requestTransfer, approveTransfer, dispatchTransfer } from "@/domains/inventory/operations-service";
import { recordAdjustment } from "@/domains/inventory/service";
import { db, pool } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

type PolicyInput = {
  operation: "purchase" | "dispose" | "transfer" | "inventory_adjustment";
  enabled: boolean;
  autonomous: boolean;
  thresholds?: Record<string, unknown>;
  approvalPermission?: string;
};

export async function upsertAutomationPolicy(actorId: string, organizationId: string, locationId: string, input: PolicyInput) {
  if (!(await hasLocationPermission(db, actorId, locationId, "automation.manage"))) throw new DomainError("FORBIDDEN");
  const result = await pool.query(`insert into automation_policies(organization_id,pantry_location_id,operation,enabled,autonomous,thresholds,approval_permission,created_by) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict(organization_id,pantry_location_id,operation) do update set enabled=excluded.enabled,autonomous=excluded.autonomous,thresholds=excluded.thresholds,approval_permission=excluded.approval_permission,updated_at=now() returning *`, [organizationId, locationId, input.operation, input.enabled, input.autonomous, JSON.stringify(input.thresholds ?? {}), input.approvalPermission ?? "inventory.adjust", actorId]);
  return result.rows[0];
}

export async function enqueueAutomationRun(actorId: string, organizationId: string, locationId: string, operation: PolicyInput["operation"]) {
  if (!(await hasLocationPermission(db, actorId, locationId, "automation.manage"))) throw new DomainError("FORBIDDEN");
  const policy = await pool.query(`select * from automation_policies where organization_id=$1 and pantry_location_id=$2 and operation=$3`, [organizationId, locationId, operation]);
  if (!policy.rows[0]) throw new DomainError("NOT_FOUND");
  const run = await pool.query(`insert into automation_runs(organization_id,pantry_location_id,policy_id) values($1,$2,$3) returning *`, [organizationId, locationId, policy.rows[0].id]);
  return run.rows[0];
}

async function purchaseActions(policy: Record<string, unknown>, runId: string, actorId: string, organizationId: string, locationId: string) {
  const threshold = (policy.thresholds ?? {}) as Record<string, unknown>;
  const minimum = Number(threshold.minimumQuantity ?? 0);
  const recommendations = await pool.query(`select r.inventory_item_id,r.recommended_quantity,i.name,i.base_unit_id from forecast_item_results r join forecast_snapshots s on s.id=r.snapshot_id join inventory_items i on i.id=r.inventory_item_id where s.organization_id=$1 and s.pantry_location_id=$2 and s.id=(select id from forecast_snapshots where organization_id=$1 and pantry_location_id=$2 order by generated_at desc limit 1) and r.recommended_quantity >= $3 order by r.recommended_quantity desc limit 25`, [organizationId, locationId, minimum]);
  const actions: unknown[] = [];
  for (const row of recommendations.rows) {
    if (!policy.autonomous) {
      actions.push({ type: "purchase", itemId: row.inventory_item_id, quantity: row.recommended_quantity, status: "pending_review" });
      continue;
    }
    const shipment = await createPurchasedShipment(actorId, organizationId, locationId, { supplierName: String(threshold.supplierName ?? "Automated replenishment"), supplierReference: `AUTO-${runId.slice(0, 8)}`, expectedAt: threshold.expectedAt ? new Date(String(threshold.expectedAt)) : null, line: { inventoryItemId: row.inventory_item_id, expectedQuantity: String(row.recommended_quantity), expectedUnitId: row.base_unit_id } }, crypto.randomUUID());
    actions.push({ type: "purchase", shipmentId: shipment.id, itemId: row.inventory_item_id, quantity: row.recommended_quantity, status: "created" });
  }
  return actions;
}

async function disposalActions(policy: Record<string, unknown>, runId: string, actorId: string, organizationId: string, locationId: string) {
  const lots = await pool.query(`select l.id,l.inventory_item_id,l.expiration_date,b.available_quantity,i.base_unit_id from inventory_lots l join inventory_lot_balances b on b.inventory_lot_id=l.id join inventory_items i on i.id=l.inventory_item_id where l.organization_id=$1 and l.pantry_location_id=$2 and l.expiration_date < (now() at time zone coalesce((select timezone from pantry_locations where id=$2),(select timezone from organizations where id=$1),'UTC'))::date and b.available_quantity > 0 order by l.expiration_date limit 50`, [organizationId, locationId]);
  const actions: unknown[] = [];
  for (const lot of lots.rows) {
    if (!policy.autonomous) {
      actions.push({ type: "dispose", lotId: lot.id, quantity: lot.available_quantity, status: "pending_review" });
      continue;
    }
    const event = await recordConditionRemoval(actorId, organizationId, { eventType: "expiration_removal", lotId: lot.id, quantity: String(lot.available_quantity), unitId: lot.base_unit_id, reason: `Automated expired-stock removal (${runId})`, idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    actions.push({ type: "dispose", eventId: event.id, lotId: lot.id, quantity: lot.available_quantity, status: "posted" });
  }
  return actions;
}

export async function processAutomationRun(runId: string) {
  const claimed = await pool.query(`update automation_runs set status='running',started_at=now() where id=$1 and status='queued' returning *`, [runId]);
  const run = claimed.rows[0];
  if (!run) return null;
  try {
    const actions = run.policy_id ? await pool.query(`select * from automation_policies where id=$1`, [run.policy_id]) : { rows: [] };
    const policy = actions.rows[0];
    if (!policy || !policy.enabled) {
      await pool.query(`update automation_runs set status='skipped',completed_at=now(),actions='[]'::jsonb where id=$1`, [runId]);
      return { id: runId, status: "skipped", actions: [] };
    }
    let result: unknown[];
    if (policy.operation === "purchase") result = await purchaseActions(policy, runId, policy.created_by, run.organization_id, run.pantry_location_id);
    else if (policy.operation === "dispose") result = await disposalActions(policy, runId, policy.created_by, run.organization_id, run.pantry_location_id);
    else {
      const threshold = (policy.thresholds ?? {}) as Record<string, unknown>;
      if (!policy.autonomous) result = [{ type: policy.operation, status: "pending_review" }];
      else if (policy.operation === "inventory_adjustment" && threshold.lotId && threshold.quantity && threshold.unitId) {
        const adjustment = await recordAdjustment(policy.created_by, run.organization_id, { lotId: String(threshold.lotId), direction: String(threshold.direction ?? "negative") === "positive" ? "positive" : "negative", quantity: String(threshold.quantity), unitId: String(threshold.unitId), reasonCode: String(threshold.reasonCode ?? "automated_adjustment"), reason: String(threshold.reason ?? `Automated adjustment (${runId})`) }, crypto.randomUUID());
        result = [{ type: policy.operation, status: "posted", adjustment }];
      } else if (policy.operation === "transfer" && threshold.sourceLocationId && threshold.destinationLocationId && threshold.lotId && threshold.quantity && threshold.unitId && threshold.approverUserId && String(threshold.approverUserId) !== String(policy.created_by)) {
        const transfer = await createTransfer(policy.created_by, run.organization_id, { transferNumber: `AUTO-${runId.slice(0, 8)}`, sourceLocationId: String(threshold.sourceLocationId), destinationLocationId: String(threshold.destinationLocationId), idempotencyKey: crypto.randomUUID(), lines: [{ lotId: String(threshold.lotId), quantity: String(threshold.quantity), unitId: String(threshold.unitId) }] }, crypto.randomUUID());
        await requestTransfer(policy.created_by, run.organization_id, transfer.id, crypto.randomUUID());
        await approveTransfer(String(threshold.approverUserId), run.organization_id, transfer.id, crypto.randomUUID());
        const dispatched = await dispatchTransfer(String(threshold.dispatcherUserId ?? threshold.approverUserId), run.organization_id, transfer.id, crypto.randomUUID());
        result = [{ type: policy.operation, status: "dispatched", transferId: dispatched.id }];
      } else result = [{ type: policy.operation, status: "pending_review", reason: "Required autonomous inputs or a distinct approver are missing." }];
    }
    await pool.query(`update automation_runs set status='completed',completed_at=now(),actions=$2::jsonb where id=$1`, [runId, JSON.stringify(result)]);
    return { id: runId, status: "completed", actions: result };
  } catch (error) {
    await pool.query(`update automation_runs set status='failed',completed_at=now(),error_summary=$2 where id=$1`, [runId, error instanceof Error ? error.message : "Automation failed"]);
    throw error;
  }
}
