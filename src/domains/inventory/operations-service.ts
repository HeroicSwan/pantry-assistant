import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as rawDb } from "@/lib/database/client";
import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import {
  adjustmentRequests,
  auditLogs,
  cycleCountEntries,
  cycleCountSessions,
  donationLines,
  donations,
  donors,
  inventoryConditionEvents,
  inventoryItemUnits,
  inventoryLots,
  inventoryLotHolds,
  inventoryRecallLots,
  inventoryRecalls,
  inventoryTransactions,
  inventoryTransferLines,
  inventoryTransferReceipts,
  inventoryTransfers,
  organizationMemberships,
  purchasedShipments,
  receivingLines,
  receivingSessions,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";
import { postInventoryTransaction, reverseInventoryTransaction } from "@/domains/inventory/ledger";
import { resolveBaseQuantity } from "@/domains/inventory/policy";
import {
  classifyAdjustmentRisk,
  countStateAllows,
  decimalDifference,
  transferCompletionStatus,
  transferStateAllows,
} from "@/domains/inventory/operations-policy";

type Transaction = Parameters<Parameters<typeof rawDb.transaction>[0]>[0];
type Direction = "positive" | "negative";

const SAFE_DATABASE_ERRORS = new Set([
  "INSUFFICIENT_STOCK",
  "LOT_ARCHIVED",
  "TRANSACTION_SIGN_INVALID",
  "OPERATION_RECORD_IMMUTABLE",
  "RECEIVING_LINE_IMMUTABLE",
  "LOT_HOLD_IMMUTABLE",
  "INVALID_OPERATION_STATE_TRANSITION",
  "TRANSFER_LINE_IMMUTABLE",
  "TRANSFER_OVER_RECEIPT",
  "TRANSFER_RECEIPT_SCOPE_MISMATCH",
]);

function databaseCause(error: unknown): { code?: string; message?: string } | null {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return { code: candidate.code, message: typeof candidate.message === "string" ? candidate.message : undefined };
    current = candidate.cause;
  }
  return null;
}

const db = {
  async transaction<T>(run: (tx: Transaction) => Promise<T>) {
    try {
      return await rawDb.transaction(run);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const cause = databaseCause(error);
      if (cause?.message && SAFE_DATABASE_ERRORS.has(cause.message)) throw new DomainError(cause.message);
      if (cause) throw Object.assign(new Error("DATABASE_OPERATION_FAILED"), { code: cause.code });
      throw error;
    }
  },
};

async function actorMembership(tx: Transaction, actorId: string, organizationId: string) {
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, actorId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active")))
    .limit(1);
  if (!membership) throw new DomainError("FORBIDDEN");
  return membership.id;
}

async function requireOrgPermission(tx: Transaction, actorId: string, organizationId: string, permission: string) {
  if (!(await hasOrganizationPermission(tx, actorId, organizationId, permission))) throw new DomainError("FORBIDDEN");
}

async function requireLocationPermission(tx: Transaction, actorId: string, locationId: string, permission: string) {
  if (!(await hasLocationPermission(tx, actorId, locationId, permission))) throw new DomainError("FORBIDDEN");
}

async function writeAudit(
  tx: Transaction,
  actorId: string,
  organizationId: string,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    locationId?: string | null;
    requestId: string;
    reason?: string | null;
    newValues?: Record<string, unknown>;
    previousValues?: Record<string, unknown>;
  },
) {
  await tx.insert(auditLogs).values({
    organizationId,
    locationId: entry.locationId ?? null,
    actorUserId: actorId,
    actorMembershipId: await actorMembership(tx, actorId, organizationId),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    requestId: entry.requestId,
    reason: entry.reason ?? null,
    newValues: entry.newValues,
    previousValues: entry.previousValues,
  });
}

async function resolveConversion(tx: Transaction, organizationId: string, itemId: string, unitId: string) {
  const [conversion] = await tx
    .select({ factor: inventoryItemUnits.factor, roundingPolicy: inventoryItemUnits.roundingPolicy })
    .from(inventoryItemUnits)
    .where(and(eq(inventoryItemUnits.organizationId, organizationId), eq(inventoryItemUnits.inventoryItemId, itemId), eq(inventoryItemUnits.unitId, unitId), eq(inventoryItemUnits.isActive, true)))
    .limit(1);
  if (!conversion) throw new DomainError("MISSING_UNIT_CONVERSION");
  return conversion;
}

function assertDateOrder(values: { receivedDate: string; bestByDate?: string | null; useByDate?: string | null; expirationDate?: string | null }) {
  for (const candidate of [values.bestByDate, values.useByDate, values.expirationDate]) {
    if (candidate && candidate < values.receivedDate) throw new DomainError("INVALID_DATE_ORDER");
  }
  if (values.bestByDate && values.expirationDate && values.bestByDate > values.expirationDate) throw new DomainError("INVALID_DATE_ORDER");
}

function positive(value: string) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new DomainError("INVALID_QUANTITY");
}

function negate(value: string) {
  return value.startsWith("-") ? value : `-${value}`;
}

export async function createDonor(
  actorId: string,
  organizationId: string,
  values: {
    donorType: typeof donors.$inferInsert.type;
    name: string;
    contactName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    stateRegion?: string | null;
    postalCode?: string | null;
    externalReference?: string | null;
    notes?: string | null;
    isAnonymousPlaceholder?: boolean;
  },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "donor.create");
    const { donorType, ...details } = values;
    const [donor] = await tx.insert(donors).values({ organizationId, type: donorType, ...details, createdBy: actorId }).returning();
    await writeAudit(tx, actorId, organizationId, { action: "donor.created", entityType: "donor", entityId: donor.id, requestId, newValues: { name: donor.name, donorType: donor.type } });
    return donor;
  });
}

export async function updateDonor(
  actorId: string,
  organizationId: string,
  donorId: string,
  values: Partial<Pick<typeof donors.$inferInsert, "name" | "contactName" | "email" | "phoneNumber" | "addressLine1" | "addressLine2" | "city" | "stateRegion" | "postalCode" | "externalReference" | "notes">>,
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "donor.update");
    const [previous] = await tx.select().from(donors).where(and(eq(donors.id, donorId), eq(donors.organizationId, organizationId))).limit(1);
    if (!previous) throw new DomainError("NOT_FOUND");
    if (previous.status === "archived") throw new DomainError("DONOR_ARCHIVED");
    const [donor] = await tx.update(donors).set(values).where(eq(donors.id, donorId)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "donor.updated", entityType: "donor", entityId: donor.id, requestId, previousValues: { name: previous.name }, newValues: { name: donor.name } });
    return donor;
  });
}

export async function archiveDonor(actorId: string, organizationId: string, donorId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "donor.archive");
    const [previous] = await tx.select().from(donors).where(and(eq(donors.id, donorId), eq(donors.organizationId, organizationId))).limit(1);
    if (!previous) throw new DomainError("NOT_FOUND");
    if (previous.isAnonymousPlaceholder) throw new DomainError("ANONYMOUS_DONOR_REQUIRED");
    const [donor] = await tx.update(donors).set({ status: "archived", archivedAt: new Date() }).where(eq(donors.id, donorId)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "donor.archived", entityType: "donor", entityId: donor.id, requestId, reason, previousValues: { status: previous.status }, newValues: { status: donor.status } });
    return donor;
  });
}

export async function createDonation(
  actorId: string,
  organizationId: string,
  pantryLocationId: string,
  values: {
    donationNumber: string;
    donorId?: string | null;
    donationDate: string;
    sourceReference?: string | null;
    notes?: string | null;
    lines: Array<{ itemId: string; quantity?: string | null; unitId?: string | null; estimatedValue?: string | null; notes?: string | null }>;
  },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "receiving.create");
    let donorId = values.donorId ?? null;
    if (!donorId) {
      const [anonymous] = await tx.select({ id: donors.id }).from(donors).where(and(eq(donors.organizationId, organizationId), eq(donors.isAnonymousPlaceholder, true))).limit(1);
      if (!anonymous) throw new DomainError("ANONYMOUS_DONOR_REQUIRED");
      donorId = anonymous.id;
    }
    const [donation] = await tx.insert(donations).values({ organizationId, pantryLocationId, donorId, donationNumber: values.donationNumber, donationDate: values.donationDate, sourceReference: values.sourceReference, notes: values.notes, status: "expected", createdBy: actorId }).returning();
    for (const line of values.lines) {
      if (line.quantity) positive(line.quantity);
      await tx.insert(donationLines).values({ donationId: donation.id, organizationId, pantryLocationId, inventoryItemId: line.itemId, expectedQuantity: line.quantity, expectedUnitId: line.unitId, estimatedValue: line.estimatedValue, notes: line.notes });
    }
    await writeAudit(tx, actorId, organizationId, { action: "donation.created", entityType: "donation", entityId: donation.id, locationId: pantryLocationId, requestId, newValues: { donationNumber: donation.donationNumber, donorId, lineCount: values.lines.length } });
    return donation;
  });
}

export async function cancelDonation(actorId: string, organizationId: string, donationId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [donation] = await tx.select().from(donations).where(and(eq(donations.id, donationId), eq(donations.organizationId, organizationId))).for("update").limit(1);
    if (!donation) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, donation.pantryLocationId, "receiving.cancel");
    if (donation.status === "completed") throw new DomainError("DONATION_ALREADY_RECEIVED");
    const [updated] = await tx.update(donations).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actorId, cancellationReason: reason }).where(eq(donations.id, donation.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "donation.cancelled", entityType: "donation", entityId: donation.id, locationId: donation.pantryLocationId, requestId, reason });
    return updated;
  });
}

export async function createPurchasedShipment(
  actorId: string,
  organizationId: string,
  pantryLocationId: string,
  values: { supplierName: string; supplierReference?: string | null; orderedAt?: Date | null; expectedAt?: Date | null; notes?: string | null },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "receiving.create");
    const [shipment] = await tx.insert(purchasedShipments).values({ organizationId, pantryLocationId, ...values, status: "ordered", createdBy: actorId }).returning();
    await writeAudit(tx, actorId, organizationId, { action: "purchase.created", entityType: "purchased_shipment", entityId: shipment.id, locationId: pantryLocationId, requestId, newValues: { supplierName: shipment.supplierName } });
    return shipment;
  });
}

export async function startReceiving(
  actorId: string,
  organizationId: string,
  pantryLocationId: string,
  values: { sourceType: "donation" | "purchase" | "other"; donationId?: string | null; purchasedShipmentId?: string | null; notes?: string | null; idempotencyKey: string },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "receiving.create");
    const [existing] = await tx.select().from(receivingSessions).where(and(eq(receivingSessions.organizationId, organizationId), eq(receivingSessions.idempotencyKey, values.idempotencyKey))).limit(1);
    if (existing) return existing;
    if (values.sourceType === "donation") {
      const [source] = await tx.select().from(donations).where(and(eq(donations.id, values.donationId ?? "00000000-0000-0000-0000-000000000000"), eq(donations.organizationId, organizationId), eq(donations.pantryLocationId, pantryLocationId))).limit(1);
      if (!source || source.status === "cancelled" || source.status === "completed") throw new DomainError("INVALID_RECEIVING_SOURCE");
      await tx.update(donations).set({ status: "receiving" }).where(eq(donations.id, source.id));
    }
    if (values.sourceType === "purchase") {
      const [source] = await tx.select().from(purchasedShipments).where(and(eq(purchasedShipments.id, values.purchasedShipmentId ?? "00000000-0000-0000-0000-000000000000"), eq(purchasedShipments.organizationId, organizationId), eq(purchasedShipments.pantryLocationId, pantryLocationId))).limit(1);
      if (!source || source.status === "cancelled" || source.status === "received") throw new DomainError("INVALID_RECEIVING_SOURCE");
      await tx.update(purchasedShipments).set({ status: "partially_received" }).where(eq(purchasedShipments.id, source.id));
    }
    const [session] = await tx.insert(receivingSessions).values({ organizationId, pantryLocationId, sourceType: values.sourceType, donationId: values.donationId, purchasedShipmentId: values.purchasedShipmentId, status: "in_progress", startedBy: actorId, idempotencyKey: values.idempotencyKey, notes: values.notes }).returning();
    await writeAudit(tx, actorId, organizationId, { action: "receiving.started", entityType: "receiving_session", entityId: session.id, locationId: pantryLocationId, requestId, newValues: { sourceType: session.sourceType } });
    return session;
  });
}

export async function addReceivingLine(
  actorId: string,
  organizationId: string,
  sessionId: string,
  values: {
    itemId: string;
    existingLotId?: string | null;
    quantity: string;
    unitId: string;
    lotNumber?: string | null;
    receivedDate: string;
    bestByDate?: string | null;
    useByDate?: string | null;
    expirationDate?: string | null;
    storageLocationId?: string | null;
    condition?: string;
    estimatedValue?: string | null;
    notes?: string | null;
  },
  requestId: string,
) {
  positive(values.quantity);
  assertDateOrder(values);
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(receivingSessions).where(and(eq(receivingSessions.id, sessionId), eq(receivingSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "receiving.create");
    if (!["draft", "in_progress", "review"].includes(session.status)) throw new DomainError("RECEIVING_SESSION_CLOSED");
    const [line] = await tx.insert(receivingLines).values({ receivingSessionId: session.id, organizationId, pantryLocationId: session.pantryLocationId, inventoryItemId: values.itemId, existingLotId: values.existingLotId, enteredQuantity: values.quantity, enteredUnitId: values.unitId, lotNumber: values.lotNumber, receivedDate: values.receivedDate, bestByDate: values.bestByDate, useByDate: values.useByDate, expirationDate: values.expirationDate, storageLocationId: values.storageLocationId, condition: values.condition ?? "good", estimatedValue: values.estimatedValue, notes: values.notes }).returning();
    await writeAudit(tx, actorId, organizationId, { action: "receiving.line_added", entityType: "receiving_line", entityId: line.id, locationId: session.pantryLocationId, requestId, newValues: { itemId: line.inventoryItemId, enteredQuantity: line.enteredQuantity } });
    return line;
  });
}

export async function completeReceiving(actorId: string, organizationId: string, sessionId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(receivingSessions).where(and(eq(receivingSessions.id, sessionId), eq(receivingSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "receiving.complete");
    if (session.status === "completed") return session;
    if (!["in_progress", "review"].includes(session.status)) throw new DomainError("RECEIVING_SESSION_CLOSED");
    const lines = await tx.select().from(receivingLines).where(and(eq(receivingLines.receivingSessionId, session.id), eq(receivingLines.status, "draft"))).orderBy(asc(receivingLines.createdAt));
    if (lines.length === 0) throw new DomainError("RECEIVING_LINES_REQUIRED");
    const membershipId = await actorMembership(tx, actorId, organizationId);
    for (const line of lines) {
      const conversion = await resolveConversion(tx, organizationId, line.inventoryItemId, line.enteredUnitId);
      const converted = resolveBaseQuantity(line.enteredQuantity, conversion.factor, conversion.roundingPolicy);
      let lotId = line.existingLotId;
      let createdLotId: string | null = null;
      if (!lotId) {
        const [lot] = await tx.insert(inventoryLots).values({ organizationId, pantryLocationId: session.pantryLocationId, inventoryItemId: line.inventoryItemId, storageLocationId: line.storageLocationId, lotCode: line.lotNumber, receivedDate: line.receivedDate, bestByDate: line.bestByDate, useByDate: line.useByDate, expirationDate: line.expirationDate, notes: line.notes, createdBy: actorId }).returning();
        lotId = lot.id;
        createdLotId = lot.id;
      }
      const transaction = await postInventoryTransaction(tx, { organizationId, pantryLocationId: session.pantryLocationId, inventoryItemId: line.inventoryItemId, inventoryLotId: lotId, transactionType: session.sourceType === "purchase" ? "purchase_received" : "donation_received", physicalDelta: converted.base, inputQuantity: line.enteredQuantity, inputUnitId: line.enteredUnitId, conversionFactor: conversion.factor, roundingDelta: converted.roundingDelta, reasonCode: "receiving_completed", reason: line.notes ?? `Received through session ${session.id}.`, sourceType: `receiving_${session.sourceType}`, sourceReferenceId: line.id, actorUserId: actorId, actorMembershipId: membershipId, requestId });
      await tx.update(receivingLines).set({ status: "completed", createdLotId, normalizedBaseQuantity: converted.base, resolvedConversionFactor: conversion.factor, transactionId: transaction.id }).where(eq(receivingLines.id, line.id));
    }
    const [completed] = await tx.update(receivingSessions).set({ status: "completed", completedBy: actorId, completedAt: new Date() }).where(eq(receivingSessions.id, session.id)).returning();
    if (session.donationId) await tx.update(donations).set({ status: "completed", receivedAt: new Date(), completedBy: actorId }).where(eq(donations.id, session.donationId));
    if (session.purchasedShipmentId) await tx.update(purchasedShipments).set({ status: "received", receivedAt: new Date() }).where(eq(purchasedShipments.id, session.purchasedShipmentId));
    await writeAudit(tx, actorId, organizationId, { action: "receiving.completed", entityType: "receiving_session", entityId: session.id, locationId: session.pantryLocationId, requestId, newValues: { lineCount: lines.length } });
    return completed;
  });
}

export async function cancelReceiving(actorId: string, organizationId: string, sessionId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(receivingSessions).where(and(eq(receivingSessions.id, sessionId), eq(receivingSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "receiving.cancel");
    if (session.status === "completed") throw new DomainError("RECEIVING_SESSION_CLOSED");
    const [cancelled] = await tx.update(receivingSessions).set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: reason }).where(eq(receivingSessions.id, session.id)).returning();
    await tx.update(receivingLines).set({ status: "cancelled" }).where(and(eq(receivingLines.receivingSessionId, session.id), eq(receivingLines.status, "draft")));
    await writeAudit(tx, actorId, organizationId, { action: "receiving.cancelled", entityType: "receiving_session", entityId: session.id, locationId: session.pantryLocationId, requestId, reason });
    return cancelled;
  });
}

async function postAdjustmentRequest(tx: Transaction, actorId: string, request: typeof adjustmentRequests.$inferSelect, requestId: string) {
  const membershipId = await actorMembership(tx, actorId, request.organizationId);
  const physicalDelta = request.direction === "positive" ? request.normalizedBaseQuantity : negate(request.normalizedBaseQuantity);
  const transaction = await postInventoryTransaction(tx, { organizationId: request.organizationId, pantryLocationId: request.pantryLocationId, inventoryItemId: request.inventoryItemId, inventoryLotId: request.inventoryLotId, transactionType: request.direction === "positive" ? "manual_positive_adjustment" : "manual_negative_adjustment", physicalDelta, inputQuantity: request.enteredQuantity, inputUnitId: request.enteredUnitId, conversionFactor: request.resolvedConversionFactor, reasonCode: request.reasonCode, reason: request.reason, sourceType: "adjustment_request", sourceReferenceId: request.id, actorUserId: actorId, actorMembershipId: membershipId, requestId });
  const [posted] = await tx.update(adjustmentRequests).set({ status: "posted", transactionId: transaction.id, postedAt: new Date() }).where(eq(adjustmentRequests.id, request.id)).returning();
  return { request: posted, transaction };
}

export async function submitAdjustment(
  actorId: string,
  organizationId: string,
  values: { lotId: string; direction: Direction; quantity: string; unitId: string; reasonCode: string; reason: string; idempotencyKey: string },
  requestId: string,
) {
  positive(values.quantity);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(adjustmentRequests).where(and(eq(adjustmentRequests.organizationId, organizationId), eq(adjustmentRequests.idempotencyKey, values.idempotencyKey))).limit(1);
    if (existing) return { request: existing, transaction: null };
    const [lot] = await tx.select({ id: inventoryLots.id, pantryLocationId: inventoryLots.pantryLocationId, inventoryItemId: inventoryLots.inventoryItemId }).from(inventoryLots).where(and(eq(inventoryLots.id, values.lotId), eq(inventoryLots.organizationId, organizationId))).for("update").limit(1);
    if (!lot) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, lot.pantryLocationId, "inventory.adjust");
    const conversion = await resolveConversion(tx, organizationId, lot.inventoryItemId, values.unitId);
    const converted = resolveBaseQuantity(values.quantity, conversion.factor, conversion.roundingPolicy);
    const balance = await tx.execute<{ physical_on_hand: string }>(sql`select physical_on_hand::text from inventory_lot_balances where inventory_lot_id = ${lot.id}`);
    const risk = classifyAdjustmentRisk(Number(converted.base), Number(balance.rows[0]?.physical_on_hand ?? 0));
    const [request] = await tx.insert(adjustmentRequests).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, direction: values.direction, enteredQuantity: values.quantity, enteredUnitId: values.unitId, resolvedConversionFactor: conversion.factor, normalizedBaseQuantity: converted.base, risk, reasonCode: values.reasonCode, reason: values.reason, requestedBy: actorId, idempotencyKey: values.idempotencyKey }).returning();
    const result = risk === "normal" ? await postAdjustmentRequest(tx, actorId, request, requestId) : { request, transaction: null };
    await writeAudit(tx, actorId, organizationId, { action: risk === "normal" ? "inventory.adjustment_posted" : "inventory.adjustment_requested", entityType: result.transaction ? "inventory_transaction" : "adjustment_request", entityId: result.transaction?.id ?? request.id, locationId: lot.pantryLocationId, requestId, reason: values.reason, newValues: { adjustmentRequestId: request.id, risk, direction: values.direction, normalizedBaseQuantity: converted.base, transactionId: result.transaction?.id ?? null } });
    return result;
  });
}

export async function approveAdjustment(actorId: string, organizationId: string, adjustmentId: string, decisionReason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(adjustmentRequests).where(and(eq(adjustmentRequests.id, adjustmentId), eq(adjustmentRequests.organizationId, organizationId))).for("update").limit(1);
    if (!request) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, request.pantryLocationId, "inventory.adjust_large");
    if (request.requestedBy === actorId) throw new DomainError("SELF_APPROVAL_FORBIDDEN");
    if (request.status !== "submitted") throw new DomainError("ADJUSTMENT_ALREADY_DECIDED");
    const [approved] = await tx.update(adjustmentRequests).set({ status: "approved", approvedBy: actorId, decisionReason, decidedAt: new Date() }).where(eq(adjustmentRequests.id, request.id)).returning();
    const result = await postAdjustmentRequest(tx, actorId, approved, requestId);
    await writeAudit(tx, actorId, organizationId, { action: "inventory.adjustment_approved", entityType: "adjustment_request", entityId: request.id, locationId: request.pantryLocationId, requestId, reason: decisionReason, newValues: { transactionId: result.transaction.id } });
    return result;
  });
}

export async function rejectAdjustment(actorId: string, organizationId: string, adjustmentId: string, decisionReason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(adjustmentRequests).where(and(eq(adjustmentRequests.id, adjustmentId), eq(adjustmentRequests.organizationId, organizationId))).for("update").limit(1);
    if (!request) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, request.pantryLocationId, "inventory.adjust_large");
    if (request.status !== "submitted") throw new DomainError("ADJUSTMENT_ALREADY_DECIDED");
    const [rejected] = await tx.update(adjustmentRequests).set({ status: "rejected", rejectedBy: actorId, decisionReason, decidedAt: new Date() }).where(eq(adjustmentRequests.id, request.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.adjustment_rejected", entityType: "adjustment_request", entityId: request.id, locationId: request.pantryLocationId, requestId, reason: decisionReason });
    return rejected;
  });
}

export async function correctTransaction(
  actorId: string,
  organizationId: string,
  transactionId: string,
  values: { direction: Direction; quantity: string; unitId: string; reasonCode: string; reason: string },
  requestId: string,
) {
  positive(values.quantity);
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(inventoryTransactions).where(and(eq(inventoryTransactions.id, transactionId), eq(inventoryTransactions.organizationId, organizationId))).limit(1);
    if (!target) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, target.pantryLocationId, "inventory.correct");
    const membershipId = await actorMembership(tx, actorId, organizationId);
    const conversion = await resolveConversion(tx, organizationId, target.inventoryItemId, values.unitId);
    const converted = resolveBaseQuantity(values.quantity, conversion.factor, conversion.roundingPolicy);
    const correlationId = crypto.randomUUID();
    const { reversal } = await reverseInventoryTransaction(tx, { transactionId, organizationId, actorUserId: actorId, actorMembershipId: membershipId, requestId, reason: values.reason, correlationId });
    const replacement = await postInventoryTransaction(tx, { organizationId, pantryLocationId: target.pantryLocationId, inventoryItemId: target.inventoryItemId, inventoryLotId: target.inventoryLotId, transactionType: values.direction === "positive" ? "manual_positive_adjustment" : "manual_negative_adjustment", physicalDelta: values.direction === "positive" ? converted.base : negate(converted.base), inputQuantity: values.quantity, inputUnitId: values.unitId, conversionFactor: conversion.factor, roundingDelta: converted.roundingDelta, reasonCode: values.reasonCode, reason: values.reason, correlationId, sourceType: "transaction_correction", sourceReferenceId: target.id, actorUserId: actorId, actorMembershipId: membershipId, requestId });
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transaction_corrected", entityType: "inventory_transaction", entityId: target.id, locationId: target.pantryLocationId, requestId, reason: values.reason, newValues: { reversalId: reversal.id, replacementId: replacement.id, correlationId } });
    return { original: target, reversal, replacement };
  });
}

const conditionPermission = {
  spoilage: "inventory.spoilage",
  damage: "inventory.damage",
  expiration_removal: "inventory.expiration_remove",
  recall_disposal: "inventory.recall_resolve",
} as const;

const conditionTransactionType = {
  spoilage: "spoilage",
  damage: "damage",
  expiration_removal: "expiration",
  recall_disposal: "recall_disposal",
} as const;

export async function recordConditionRemoval(
  actorId: string,
  organizationId: string,
  values: { eventType: keyof typeof conditionPermission; lotId: string; quantity: string; unitId: string; reason: string; recallId?: string | null; idempotencyKey: string },
  requestId: string,
) {
  positive(values.quantity);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(inventoryConditionEvents).where(and(eq(inventoryConditionEvents.organizationId, organizationId), eq(inventoryConditionEvents.idempotencyKey, values.idempotencyKey))).limit(1);
    if (existing) return existing;
    const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, values.lotId), eq(inventoryLots.organizationId, organizationId))).for("update").limit(1);
    if (!lot) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, lot.pantryLocationId, conditionPermission[values.eventType]);
    if (values.eventType === "expiration_removal") {
      const localDate = await tx.execute<{ today: string }>(sql`select (now() at time zone coalesce(p.timezone, o.timezone))::date::text as today from pantry_locations p join organizations o on o.id = p.organization_id where p.id = ${lot.pantryLocationId}`);
      if (!lot.expirationDate || lot.expirationDate >= localDate.rows[0].today) throw new DomainError("LOT_NOT_EXPIRED");
    }
    if (values.eventType === "recall_disposal") {
      const [hold] = await tx.select({ id: inventoryLotHolds.id }).from(inventoryLotHolds).where(and(eq(inventoryLotHolds.inventoryLotId, lot.id), eq(inventoryLotHolds.holdType, "recall"), eq(inventoryLotHolds.status, "active"))).limit(1);
      if (!hold) throw new DomainError("ACTIVE_RECALL_REQUIRED");
    }
    const conversion = await resolveConversion(tx, organizationId, lot.inventoryItemId, values.unitId);
    const converted = resolveBaseQuantity(values.quantity, conversion.factor, conversion.roundingPolicy);
    const transaction = await postInventoryTransaction(tx, { organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, transactionType: conditionTransactionType[values.eventType], physicalDelta: negate(converted.base), inputQuantity: values.quantity, inputUnitId: values.unitId, conversionFactor: conversion.factor, roundingDelta: converted.roundingDelta, reasonCode: values.eventType, reason: values.reason, sourceType: "condition_event", sourceReferenceId: values.idempotencyKey, actorUserId: actorId, actorMembershipId: await actorMembership(tx, actorId, organizationId), requestId });
    const [event] = await tx.insert(inventoryConditionEvents).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, eventType: values.eventType, enteredQuantity: values.quantity, enteredUnitId: values.unitId, normalizedBaseQuantity: converted.base, transactionId: transaction.id, recallId: values.recallId, reason: values.reason, actorUserId: actorId, idempotencyKey: values.idempotencyKey }).returning();
    await writeAudit(tx, actorId, organizationId, { action: `inventory.${values.eventType}`, entityType: "inventory_condition_event", entityId: event.id, locationId: lot.pantryLocationId, requestId, reason: values.reason, newValues: { lotId: lot.id, transactionId: transaction.id, quantity: converted.base } });
    return event;
  });
}

export async function placeQuarantine(actorId: string, organizationId: string, lotId: string, reason: string, idempotencyKey: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(inventoryConditionEvents).where(and(eq(inventoryConditionEvents.organizationId, organizationId), eq(inventoryConditionEvents.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) return existing;
    const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.organizationId, organizationId))).for("update").limit(1);
    if (!lot) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, lot.pantryLocationId, "inventory.quarantine");
    const [event] = await tx.insert(inventoryConditionEvents).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, eventType: "quarantine_placed", reason, actorUserId: actorId, idempotencyKey }).returning();
    await tx.insert(inventoryLotHolds).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryLotId: lot.id, holdType: "quarantine", conditionEventId: event.id, placedBy: actorId, reason });
    await writeAudit(tx, actorId, organizationId, { action: "inventory.quarantine_placed", entityType: "inventory_lot", entityId: lot.id, locationId: lot.pantryLocationId, requestId, reason });
    return event;
  });
}

export async function releaseQuarantine(actorId: string, organizationId: string, lotId: string, resolution: string, idempotencyKey: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.organizationId, organizationId))).for("update").limit(1);
    if (!lot) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, lot.pantryLocationId, "inventory.quarantine_release");
    const [hold] = await tx.select().from(inventoryLotHolds).where(and(eq(inventoryLotHolds.inventoryLotId, lot.id), eq(inventoryLotHolds.holdType, "quarantine"), eq(inventoryLotHolds.status, "active"))).for("update").limit(1);
    if (!hold) throw new DomainError("ACTIVE_QUARANTINE_REQUIRED");
    const [event] = await tx.insert(inventoryConditionEvents).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, eventType: "quarantine_released", reason: resolution, actorUserId: actorId, idempotencyKey }).returning();
    await tx.update(inventoryLotHolds).set({ status: "released", releasedBy: actorId, releasedAt: new Date(), resolution }).where(eq(inventoryLotHolds.id, hold.id));
    await writeAudit(tx, actorId, organizationId, { action: "inventory.quarantine_released", entityType: "inventory_lot", entityId: lot.id, locationId: lot.pantryLocationId, requestId, reason: resolution, newValues: { conditionEventId: event.id } });
    return event;
  });
}

export async function createRecall(
  actorId: string,
  organizationId: string,
  values: { referenceCode: string; title: string; description: string; lotIds: string[] },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.recall");
    if (values.lotIds.length === 0) throw new DomainError("RECALL_LOTS_REQUIRED");
    const lots = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.organizationId, organizationId), inArray(inventoryLots.id, values.lotIds))).orderBy(asc(inventoryLots.id));
    if (lots.length !== new Set(values.lotIds).size) throw new DomainError("CROSS_ORGANIZATION_REFERENCE");
    const [recall] = await tx.insert(inventoryRecalls).values({ organizationId, referenceCode: values.referenceCode, title: values.title, description: values.description, status: "active", createdBy: actorId, activatedAt: new Date() }).returning();
    for (const lot of lots) {
      await requireLocationPermission(tx, actorId, lot.pantryLocationId, "inventory.recall");
      const [event] = await tx.insert(inventoryConditionEvents).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, eventType: "recall_placed", recallId: recall.id, reason: values.description, actorUserId: actorId, idempotencyKey: crypto.randomUUID() }).returning();
      await tx.insert(inventoryRecallLots).values({ recallId: recall.id, inventoryLotId: lot.id, organizationId });
      await tx.insert(inventoryLotHolds).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryLotId: lot.id, holdType: "recall", conditionEventId: event.id, recallId: recall.id, placedBy: actorId, reason: values.description });
    }
    await writeAudit(tx, actorId, organizationId, { action: "inventory.recall_activated", entityType: "inventory_recall", entityId: recall.id, requestId, newValues: { referenceCode: recall.referenceCode, lotCount: lots.length } });
    return recall;
  });
}

export async function resolveRecall(actorId: string, organizationId: string, recallId: string, resolution: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.recall_resolve");
    const [recall] = await tx.select().from(inventoryRecalls).where(and(eq(inventoryRecalls.id, recallId), eq(inventoryRecalls.organizationId, organizationId))).for("update").limit(1);
    if (!recall) throw new DomainError("NOT_FOUND");
    if (recall.status !== "active") throw new DomainError("RECALL_NOT_ACTIVE");
    const holds = await tx.select().from(inventoryLotHolds).where(and(eq(inventoryLotHolds.recallId, recall.id), eq(inventoryLotHolds.status, "active"))).orderBy(asc(inventoryLotHolds.inventoryLotId));
    for (const hold of holds) {
      const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, hold.inventoryLotId)).limit(1);
      await requireLocationPermission(tx, actorId, lot.pantryLocationId, "inventory.recall_resolve");
      await tx.insert(inventoryConditionEvents).values({ organizationId, pantryLocationId: lot.pantryLocationId, inventoryItemId: lot.inventoryItemId, inventoryLotId: lot.id, eventType: "recall_resolved", recallId: recall.id, reason: resolution, actorUserId: actorId, idempotencyKey: crypto.randomUUID() });
      await tx.update(inventoryLotHolds).set({ status: "released", releasedBy: actorId, releasedAt: new Date(), resolution }).where(eq(inventoryLotHolds.id, hold.id));
    }
    const [resolved] = await tx.update(inventoryRecalls).set({ status: "resolved", resolvedBy: actorId, resolvedAt: new Date(), resolution }).where(eq(inventoryRecalls.id, recall.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.recall_resolved", entityType: "inventory_recall", entityId: recall.id, requestId, reason: resolution, newValues: { releasedLotCount: holds.length } });
    return resolved;
  });
}

export async function startCycleCount(actorId: string, organizationId: string, pantryLocationId: string, notes: string | null, idempotencyKey: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "inventory.reconcile");
    const [existing] = await tx.select().from(cycleCountSessions).where(and(eq(cycleCountSessions.organizationId, organizationId), eq(cycleCountSessions.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) return existing;
    const [session] = await tx.insert(cycleCountSessions).values({ organizationId, pantryLocationId, status: "counting", startedBy: actorId, idempotencyKey, notes }).returning();
    const balances = await tx.execute<{ inventory_lot_id: string; inventory_item_id: string; physical_on_hand: string }>(sql`select inventory_lot_id, inventory_item_id, physical_on_hand::text from inventory_lot_balances where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and lot_status <> 'archived' order by inventory_lot_id`);
    for (const balance of balances.rows) await tx.insert(cycleCountEntries).values({ countSessionId: session.id, organizationId, pantryLocationId, inventoryItemId: balance.inventory_item_id, inventoryLotId: balance.inventory_lot_id, snapshotQuantity: balance.physical_on_hand });
    await writeAudit(tx, actorId, organizationId, { action: "inventory.count_started", entityType: "cycle_count_session", entityId: session.id, locationId: pantryLocationId, requestId, newValues: { lotCount: balances.rows.length, snapshotAt: session.snapshotAt.toISOString() } });
    return session;
  });
}

export async function enterCycleCount(actorId: string, organizationId: string, sessionId: string, entryId: string, quantity: string, unitId: string, notes: string | null, requestId: string) {
  if (Number(quantity) < 0 || !Number.isFinite(Number(quantity))) throw new DomainError("INVALID_QUANTITY");
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(cycleCountSessions).where(and(eq(cycleCountSessions.id, sessionId), eq(cycleCountSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "inventory.reconcile");
    if (!countStateAllows(session.status, "enter")) throw new DomainError("COUNT_SESSION_CLOSED");
    const [entry] = await tx.select().from(cycleCountEntries).where(and(eq(cycleCountEntries.id, entryId), eq(cycleCountEntries.countSessionId, session.id))).limit(1);
    if (!entry) throw new DomainError("NOT_FOUND");
    const conversion = await resolveConversion(tx, organizationId, entry.inventoryItemId, unitId);
    const normalized = Number(quantity) === 0 ? "0" : resolveBaseQuantity(quantity, conversion.factor, conversion.roundingPolicy).base;
    const [updated] = await tx.update(cycleCountEntries).set({ countedQuantity: quantity, countedUnitId: unitId, normalizedCountedQuantity: normalized, varianceQuantity: decimalDifference(normalized, entry.snapshotQuantity), countedBy: actorId, countedAt: new Date(), notes }).where(eq(cycleCountEntries.id, entry.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.count_entered", entityType: "cycle_count_entry", entityId: entry.id, locationId: session.pantryLocationId, requestId, newValues: { normalizedCountedQuantity: normalized, varianceQuantity: updated.varianceQuantity } });
    return updated;
  });
}

export async function submitCycleCount(actorId: string, organizationId: string, sessionId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(cycleCountSessions).where(and(eq(cycleCountSessions.id, sessionId), eq(cycleCountSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "inventory.reconcile");
    if (!countStateAllows(session.status, "submit")) throw new DomainError("COUNT_SESSION_CLOSED");
    const missing = await tx.execute<{ count: string }>(sql`select count(*)::text as count from cycle_count_entries where count_session_id = ${session.id} and normalized_counted_quantity is null`);
    if (Number(missing.rows[0].count) > 0) throw new DomainError("COUNT_ENTRIES_INCOMPLETE");
    const [submitted] = await tx.update(cycleCountSessions).set({ status: "submitted", submittedBy: actorId, submittedAt: new Date() }).where(eq(cycleCountSessions.id, session.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.count_submitted", entityType: "cycle_count_session", entityId: session.id, locationId: session.pantryLocationId, requestId });
    return submitted;
  });
}

export async function approveCycleCount(actorId: string, organizationId: string, sessionId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(cycleCountSessions).where(and(eq(cycleCountSessions.id, sessionId), eq(cycleCountSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "inventory.reconcile_approve");
    if (!countStateAllows(session.status, "approve")) throw new DomainError("COUNT_SESSION_CLOSED");
    if (session.startedBy === actorId) throw new DomainError("SELF_APPROVAL_FORBIDDEN");
    const [approved] = await tx.update(cycleCountSessions).set({ status: "approved", approvedBy: actorId, approvedAt: new Date() }).where(eq(cycleCountSessions.id, session.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.count_approved", entityType: "cycle_count_session", entityId: session.id, locationId: session.pantryLocationId, requestId });
    return approved;
  });
}

export async function reconcileCycleCount(actorId: string, organizationId: string, sessionId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(cycleCountSessions).where(and(eq(cycleCountSessions.id, sessionId), eq(cycleCountSessions.organizationId, organizationId))).for("update").limit(1);
    if (!session) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, session.pantryLocationId, "inventory.reconcile_approve");
    if (!countStateAllows(session.status, "reconcile")) throw new DomainError("COUNT_SESSION_CLOSED");
    const entries = await tx.select().from(cycleCountEntries).where(eq(cycleCountEntries.countSessionId, session.id)).orderBy(asc(cycleCountEntries.inventoryLotId));
    const changed = await tx.execute<{ count: string }>(sql`select count(*)::text as count from inventory_transactions where pantry_location_id = ${session.pantryLocationId} and occurred_at > ${session.snapshotAt}`);
    if (Number(changed.rows[0].count) > 0) {
      const [stale] = await tx.update(cycleCountSessions).set({ status: "stale" }).where(eq(cycleCountSessions.id, session.id)).returning();
      await writeAudit(tx, actorId, organizationId, { action: "inventory.count_stale", entityType: "cycle_count_session", entityId: session.id, locationId: session.pantryLocationId, requestId, reason: "Ledger changed after the count snapshot." });
      return { session: stale, stale: true, posted: 0 };
    }
    const membershipId = await actorMembership(tx, actorId, organizationId);
    let posted = 0;
    for (const entry of entries) {
      const variance = Number(entry.varianceQuantity ?? 0);
      if (variance === 0) continue;
      const transaction = await postInventoryTransaction(tx, { organizationId, pantryLocationId: session.pantryLocationId, inventoryItemId: entry.inventoryItemId, inventoryLotId: entry.inventoryLotId, transactionType: variance > 0 ? "manual_positive_adjustment" : "manual_negative_adjustment", physicalDelta: entry.varianceQuantity as string, reasonCode: "cycle_count_reconciliation", reason: entry.notes ?? `Cycle count ${session.id} reconciliation.`, sourceType: "cycle_count", sourceReferenceId: entry.id, actorUserId: actorId, actorMembershipId: membershipId, requestId });
      await tx.update(cycleCountEntries).set({ transactionId: transaction.id }).where(eq(cycleCountEntries.id, entry.id));
      posted += 1;
    }
    const [reconciled] = await tx.update(cycleCountSessions).set({ status: "reconciled", reconciledAt: new Date() }).where(eq(cycleCountSessions.id, session.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.count_reconciled", entityType: "cycle_count_session", entityId: session.id, locationId: session.pantryLocationId, requestId, newValues: { posted } });
    return { session: reconciled, stale: false, posted };
  });
}

export async function createTransfer(
  actorId: string,
  organizationId: string,
  values: {
    transferNumber: string;
    sourceLocationId: string;
    destinationLocationId: string;
    notes?: string | null;
    idempotencyKey: string;
    lines: Array<{ lotId: string; quantity: string; unitId: string }>;
  },
  requestId: string,
) {
  if (values.lines.length === 0) throw new DomainError("TRANSFER_LINES_REQUIRED");
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, values.sourceLocationId, "inventory.transfer");
    const [existing] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.organizationId, organizationId), eq(inventoryTransfers.idempotencyKey, values.idempotencyKey))).limit(1);
    if (existing) return existing;
    const [transfer] = await tx.insert(inventoryTransfers).values({ organizationId, transferNumber: values.transferNumber, sourceLocationId: values.sourceLocationId, destinationLocationId: values.destinationLocationId, requestedBy: actorId, idempotencyKey: values.idempotencyKey, notes: values.notes }).returning();
    for (const line of values.lines) {
      positive(line.quantity);
      const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, line.lotId), eq(inventoryLots.organizationId, organizationId), eq(inventoryLots.pantryLocationId, values.sourceLocationId))).limit(1);
      if (!lot) throw new DomainError("CROSS_LOCATION_REFERENCE");
      const conversion = await resolveConversion(tx, organizationId, lot.inventoryItemId, line.unitId);
      const converted = resolveBaseQuantity(line.quantity, conversion.factor, conversion.roundingPolicy);
      await tx.insert(inventoryTransferLines).values({ transferId: transfer.id, organizationId, inventoryItemId: lot.inventoryItemId, sourceLotId: lot.id, requestedQuantity: line.quantity, requestedUnitId: line.unitId, resolvedConversionFactor: conversion.factor, requestedBaseQuantity: converted.base });
    }
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_created", entityType: "inventory_transfer", entityId: transfer.id, locationId: values.sourceLocationId, requestId, newValues: { transferNumber: transfer.transferNumber, destinationLocationId: values.destinationLocationId, lineCount: values.lines.length } });
    return transfer;
  });
}

export async function requestTransfer(actorId: string, organizationId: string, transferId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.sourceLocationId, "inventory.transfer");
    if (!transferStateAllows(transfer.status, "request")) throw new DomainError("INVALID_TRANSFER_STATE");
    const [requested] = await tx.update(inventoryTransfers).set({ status: "requested", requestedAt: new Date() }).where(eq(inventoryTransfers.id, transfer.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_requested", entityType: "inventory_transfer", entityId: transfer.id, locationId: transfer.sourceLocationId, requestId });
    return requested;
  });
}

export async function approveTransfer(actorId: string, organizationId: string, transferId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.sourceLocationId, "inventory.transfer_approve");
    if (!transferStateAllows(transfer.status, "approve")) throw new DomainError("INVALID_TRANSFER_STATE");
    if (transfer.requestedBy === actorId) throw new DomainError("SELF_APPROVAL_FORBIDDEN");
    const [approved] = await tx.update(inventoryTransfers).set({ status: "approved", approvedBy: actorId, approvedAt: new Date() }).where(eq(inventoryTransfers.id, transfer.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_approved", entityType: "inventory_transfer", entityId: transfer.id, locationId: transfer.sourceLocationId, requestId });
    return approved;
  });
}

export async function dispatchTransfer(actorId: string, organizationId: string, transferId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.sourceLocationId, "inventory.transfer_dispatch");
    if (!transferStateAllows(transfer.status, "dispatch")) throw new DomainError("INVALID_TRANSFER_STATE");
    const lines = await tx.select().from(inventoryTransferLines).where(eq(inventoryTransferLines.transferId, transfer.id)).orderBy(asc(inventoryTransferLines.id));
    if (lines.length === 0) throw new DomainError("TRANSFER_LINES_REQUIRED");
    const membershipId = await actorMembership(tx, actorId, organizationId);
    for (const line of lines) {
      const transaction = await postInventoryTransaction(tx, { organizationId, pantryLocationId: transfer.sourceLocationId, inventoryItemId: line.inventoryItemId, inventoryLotId: line.sourceLotId, transactionType: "transfer_out", physicalDelta: negate(line.requestedBaseQuantity), inputQuantity: line.requestedQuantity, inputUnitId: line.requestedUnitId, conversionFactor: line.resolvedConversionFactor, reasonCode: "transfer_dispatch", reason: transfer.notes ?? `Transfer ${transfer.transferNumber} dispatched.`, correlationId: transfer.id, sourceType: "inventory_transfer", sourceReferenceId: line.id, actorUserId: actorId, actorMembershipId: membershipId, requestId });
      await tx.update(inventoryTransferLines).set({ dispatchedBaseQuantity: line.requestedBaseQuantity, transferOutTransactionId: transaction.id }).where(eq(inventoryTransferLines.id, line.id));
    }
    const [dispatched] = await tx.update(inventoryTransfers).set({ status: "dispatched", dispatchedBy: actorId, dispatchedAt: new Date() }).where(eq(inventoryTransfers.id, transfer.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_dispatched", entityType: "inventory_transfer", entityId: transfer.id, locationId: transfer.sourceLocationId, requestId, newValues: { lineCount: lines.length } });
    return dispatched;
  });
}

export async function receiveTransferLine(
  actorId: string,
  organizationId: string,
  transferId: string,
  lineId: string,
  values: { quantity: string; unitId: string; destinationLotId?: string | null; storageLocationId?: string | null; discrepancyReason?: string | null; idempotencyKey: string },
  requestId: string,
) {
  positive(values.quantity);
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.destinationLocationId, "inventory.transfer_receive");
    if (!transferStateAllows(transfer.status, "receive")) throw new DomainError("INVALID_TRANSFER_STATE");
    const [existing] = await tx.select().from(inventoryTransferReceipts).where(and(eq(inventoryTransferReceipts.transferId, transfer.id), eq(inventoryTransferReceipts.idempotencyKey, values.idempotencyKey))).limit(1);
    if (existing) return existing;
    const [line] = await tx.select().from(inventoryTransferLines).where(and(eq(inventoryTransferLines.id, lineId), eq(inventoryTransferLines.transferId, transfer.id))).for("update").limit(1);
    if (!line) throw new DomainError("NOT_FOUND");
    const conversion = await resolveConversion(tx, organizationId, line.inventoryItemId, values.unitId);
    const converted = resolveBaseQuantity(values.quantity, conversion.factor, conversion.roundingPolicy);
    if (Number(line.receivedBaseQuantity) + Number(converted.base) > Number(line.dispatchedBaseQuantity)) throw new DomainError("TRANSFER_OVER_RECEIPT");
    const [sourceLot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, line.sourceLotId)).limit(1);
    let destinationLotId = values.destinationLotId ?? null;
    if (!destinationLotId) {
      const [destinationLot] = await tx.insert(inventoryLots).values({ organizationId, pantryLocationId: transfer.destinationLocationId, inventoryItemId: line.inventoryItemId, storageLocationId: values.storageLocationId, lotCode: sourceLot.lotCode, receivedDate: new Date().toISOString().slice(0, 10), bestByDate: sourceLot.bestByDate, useByDate: sourceLot.useByDate, expirationDate: sourceLot.expirationDate, notes: `Received from transfer ${transfer.transferNumber}.`, createdBy: actorId }).returning();
      destinationLotId = destinationLot.id;
    }
    const receiptId = crypto.randomUUID();
    const transaction = await postInventoryTransaction(tx, { organizationId, pantryLocationId: transfer.destinationLocationId, inventoryItemId: line.inventoryItemId, inventoryLotId: destinationLotId, transactionType: "transfer_in", physicalDelta: converted.base, inputQuantity: values.quantity, inputUnitId: values.unitId, conversionFactor: conversion.factor, roundingDelta: converted.roundingDelta, reasonCode: "transfer_receipt", reason: values.discrepancyReason ?? `Transfer ${transfer.transferNumber} received.`, correlationId: transfer.id, sourceType: "inventory_transfer_receipt", sourceReferenceId: receiptId, actorUserId: actorId, actorMembershipId: await actorMembership(tx, actorId, organizationId), requestId });
    const [receipt] = await tx.insert(inventoryTransferReceipts).values({ id: receiptId, transferId: transfer.id, transferLineId: line.id, organizationId, destinationLocationId: transfer.destinationLocationId, destinationLotId, receivedBaseQuantity: converted.base, transferInTransactionId: transaction.id, receivedBy: actorId, idempotencyKey: values.idempotencyKey, discrepancyReason: values.discrepancyReason }).returning();
    await tx.update(inventoryTransferLines).set({ receivedBaseQuantity: sql`${inventoryTransferLines.receivedBaseQuantity} + ${converted.base}` }).where(eq(inventoryTransferLines.id, line.id));
    const totals = await tx.execute<{ dispatched: string; received: string }>(sql`select sum(dispatched_base_quantity)::text as dispatched, sum(received_base_quantity)::text as received from inventory_transfer_lines where transfer_id = ${transfer.id}`);
    const status = transferCompletionStatus(Number(totals.rows[0].dispatched), Number(totals.rows[0].received));
    await tx.update(inventoryTransfers).set({ status, receivedBy: actorId, receivedAt: status === "received" ? new Date() : null }).where(eq(inventoryTransfers.id, transfer.id));
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_received", entityType: "inventory_transfer_receipt", entityId: receipt.id, locationId: transfer.destinationLocationId, requestId, newValues: { transferId: transfer.id, lineId: line.id, quantity: converted.base, status } });
    return receipt;
  });
}

export async function cancelTransfer(actorId: string, organizationId: string, transferId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.sourceLocationId, "inventory.transfer_cancel");
    if (!transferStateAllows(transfer.status, "cancel")) throw new DomainError("INVALID_TRANSFER_STATE");
    const [cancelled] = await tx.update(inventoryTransfers).set({ status: "cancelled", cancelledBy: actorId, cancelledAt: new Date(), cancellationReason: reason }).where(eq(inventoryTransfers.id, transfer.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_cancelled", entityType: "inventory_transfer", entityId: transfer.id, locationId: transfer.sourceLocationId, requestId, reason });
    return cancelled;
  });
}

export async function resolveTransferDiscrepancy(actorId: string, organizationId: string, transferId: string, notes: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.organizationId, organizationId))).for("update").limit(1);
    if (!transfer) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, transfer.destinationLocationId, "inventory.transfer_discrepancy");
    if (!transferStateAllows(transfer.status, "resolve")) throw new DomainError("INVALID_TRANSFER_STATE");
    const [resolved] = await tx.update(inventoryTransfers).set({ status: "discrepancy_resolved", discrepancyNotes: notes, receivedBy: actorId, receivedAt: new Date() }).where(eq(inventoryTransfers.id, transfer.id)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transfer_discrepancy_resolved", entityType: "inventory_transfer", entityId: transfer.id, locationId: transfer.destinationLocationId, requestId, reason: notes });
    return resolved;
  });
}
