import "server-only";

import { createPurchasedShipment, recordConditionRemoval } from "@/domains/inventory/operations-service";
import { db, pool } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { getServerEnvironment } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export type AutonomousAction = "create_purchase_order" | "dispose_expired_stock";

export async function createAutonomousWrite(input: { actorId: string; organizationId: string; locationId: string; actionType: AutonomousAction; payload: Record<string, unknown>; conversationId?: string | null }) {
  if (!getServerEnvironment().ASSISTANT_AUTONOMOUS_WRITES_ENABLED) throw new DomainError("AUTONOMOUS_WRITES_DISABLED");
  if (!(await hasLocationPermission(db, input.actorId, input.locationId, "assistant.autonomous_write"))) throw new DomainError("FORBIDDEN");
  const result = await pool.query(`insert into ai_write_actions(organization_id,pantry_location_id,conversation_id,action_type,payload,autonomous,created_by) values($1,$2,$3,$4,$5::jsonb,true,$6) returning *`, [input.organizationId, input.locationId, input.conversationId ?? null, input.actionType, JSON.stringify(input.payload), input.actorId]);
  return result.rows[0];
}

export async function executeAutonomousWrite(actionId: string) {
  const claimed = await pool.query(`update ai_write_actions set status='executing' where id=$1 and status='pending' and autonomous returning *`, [actionId]);
  const action = claimed.rows[0];
  if (!action) return null;
  try {
    const payload = action.payload as Record<string, unknown>;
    const result = action.action_type === "create_purchase_order"
      ? await createPurchasedShipment(action.created_by, action.organization_id, action.pantry_location_id, { supplierName: String(payload.supplierName ?? "Autonomous replenishment"), supplierReference: String(payload.supplierReference ?? `AI-${action.id.slice(0, 8)}`), line: { inventoryItemId: String(payload.inventoryItemId), expectedQuantity: String(payload.expectedQuantity), expectedUnitId: String(payload.expectedUnitId) } }, crypto.randomUUID())
      : await recordConditionRemoval(action.created_by, action.organization_id, { eventType: "expiration_removal", lotId: String(payload.lotId), quantity: String(payload.quantity), unitId: String(payload.unitId), reason: String(payload.reason ?? "Autonomous expired-stock removal"), idempotencyKey: crypto.randomUUID() }, crypto.randomUUID());
    await pool.query(`update ai_write_actions set status='completed',result=$2::jsonb,completed_at=now() where id=$1`, [action.id, JSON.stringify(result)]);
    return result;
  } catch (error) {
    await pool.query(`update ai_write_actions set status='failed',error_summary=$2,completed_at=now() where id=$1`, [action.id, error instanceof Error ? error.message : "AUTONOMOUS_WRITE_FAILED"]);
    throw error;
  }
}
