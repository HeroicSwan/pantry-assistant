import "server-only";

import { and, eq } from "drizzle-orm";
import type { db } from "@/lib/database/client";
import { inventoryLots, inventoryTransactions } from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";
import type { TransactionType } from "@/domains/inventory/policy";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LedgerTransaction = typeof inventoryTransactions.$inferSelect;

export type PostTransactionInput = {
  organizationId: string;
  pantryLocationId: string;
  inventoryItemId: string;
  inventoryLotId: string;
  transactionType: TransactionType;
  /** Signed base-unit delta as a decimal string. Never derived from client input. */
  physicalDelta: string;
  inputQuantity?: string | null;
  inputUnitId?: string | null;
  conversionFactor?: string | null;
  roundingDelta?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  reversesTransactionId?: string | null;
  sourceType?: string | null;
  sourceReferenceId?: string | null;
  sourceReference?: string | null;
  actorUserId: string;
  actorMembershipId?: string | null;
  requestId: string;
};

function negateDecimal(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("-")) return trimmed.slice(1);
  if (trimmed === "0") return "0";
  return `-${trimmed}`;
}

/**
 * Post one immutable ledger entry. Locks the target lot row so concurrent posts to the same lot are
 * serialized; the database triggers then enforce sign, archived-lot, reversal exactness, and
 * negative-stock invariants as the final boundary.
 */
export async function postInventoryTransaction(
  tx: Transaction,
  input: PostTransactionInput,
): Promise<LedgerTransaction> {
  const [lot] = await tx
    .select({
      id: inventoryLots.id,
      organizationId: inventoryLots.organizationId,
      pantryLocationId: inventoryLots.pantryLocationId,
      inventoryItemId: inventoryLots.inventoryItemId,
    })
    .from(inventoryLots)
    .where(eq(inventoryLots.id, input.inventoryLotId))
    .for("update")
    .limit(1);

  if (!lot) throw new DomainError("NOT_FOUND");
  if (
    lot.organizationId !== input.organizationId ||
    lot.pantryLocationId !== input.pantryLocationId ||
    lot.inventoryItemId !== input.inventoryItemId
  ) {
    throw new DomainError("CROSS_LOCATION_REFERENCE");
  }

  const [posted] = await tx
    .insert(inventoryTransactions)
    .values({
      organizationId: input.organizationId,
      pantryLocationId: input.pantryLocationId,
      inventoryItemId: input.inventoryItemId,
      inventoryLotId: input.inventoryLotId,
      transactionType: input.transactionType,
      physicalDelta: input.physicalDelta,
      inputQuantity: input.inputQuantity ?? null,
      inputUnitId: input.inputUnitId ?? null,
      conversionFactor: input.conversionFactor ?? null,
      roundingDelta: input.roundingDelta ?? null,
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
      reversesTransactionId: input.reversesTransactionId ?? null,
      sourceType: input.sourceType ?? null,
      sourceReferenceId: input.sourceReferenceId ?? null,
      sourceReference: input.sourceReference ?? null,
      actorUserId: input.actorUserId,
      actorMembershipId: input.actorMembershipId ?? null,
      requestId: input.requestId,
    })
    .returning();

  return posted;
}

/**
 * Reverse a posted transaction by appending an exact compensating entry. Preserves the original,
 * blocks double reversal, and refuses to reverse a reversal. Negative-stock protection still applies,
 * so a reversal that would invalidate stock is rejected in favor of a manager-designed correction.
 */
export async function reverseInventoryTransaction(
  tx: Transaction,
  input: {
    transactionId: string;
    organizationId: string;
    actorUserId: string;
    actorMembershipId?: string | null;
    requestId: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<{ reversal: LedgerTransaction; original: LedgerTransaction }> {
  const [original] = await tx
    .select()
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.id, input.transactionId), eq(inventoryTransactions.organizationId, input.organizationId)))
    .limit(1);

  if (!original) throw new DomainError("REVERSAL_TARGET_NOT_FOUND");
  if (original.transactionType === "reversal") throw new DomainError("CANNOT_REVERSE_REVERSAL");

  const [existing] = await tx
    .select({ id: inventoryTransactions.id })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.reversesTransactionId, input.transactionId))
    .limit(1);
  if (existing) throw new DomainError("ALREADY_REVERSED");

  const reversal = await postInventoryTransaction(tx, {
    organizationId: original.organizationId,
    pantryLocationId: original.pantryLocationId,
    inventoryItemId: original.inventoryItemId,
    inventoryLotId: original.inventoryLotId,
    transactionType: "reversal",
    physicalDelta: negateDecimal(original.physicalDelta),
    inputQuantity: original.inputQuantity ? negateDecimal(original.inputQuantity) : null,
    inputUnitId: original.inputUnitId,
    conversionFactor: original.conversionFactor,
    reasonCode: "reversal",
    reason: input.reason,
    correlationId: input.correlationId ?? original.correlationId ?? original.id,
    reversesTransactionId: original.id,
    sourceType: original.sourceType,
    sourceReferenceId: original.sourceReferenceId,
    sourceReference: original.sourceReference,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId ?? null,
    requestId: input.requestId,
  });

  return { reversal, original };
}
