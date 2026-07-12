import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission, hasOrganizationPermission } from "@/lib/database/authorization";
import {
  auditLogs,
  inventoryCategories,
  inventoryItemUnits,
  inventoryItems,
  inventoryLots,
  inventoryTransactions,
  organizationMemberships,
  storageLocations,
  unitsOfMeasure,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";
import { normalizeSlug } from "@/lib/validation";
import { resolveBaseQuantity } from "@/domains/inventory/policy";
import { postInventoryTransaction, reverseInventoryTransaction } from "@/domains/inventory/ledger";
import { submitAdjustment } from "@/domains/inventory/operations-service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Database triggers raise ledger invariants (e.g. INSUFFICIENT_STOCK) as PostgreSQL errors, which the
// Drizzle driver wraps in a DrizzleQueryError. Normalize those into DomainErrors so callers and the UI
// receive stable, safe messages instead of a raw wrapped query error.
const LEDGER_TRIGGER_MESSAGES = new Set([
  "INSUFFICIENT_STOCK",
  "LEDGER_IMMUTABLE",
  "LOT_ARCHIVED",
  "TRANSACTION_SIGN_INVALID",
  "UNIT_DIMENSION_MISMATCH",
  "REVERSAL_TARGET_NOT_FOUND",
  "CANNOT_REVERSE_REVERSAL",
  "REVERSAL_SCOPE_MISMATCH",
  "REVERSAL_DELTA_MISMATCH",
]);

function pgCause(error: unknown): { code?: string; message?: string } | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, message: typeof candidate.message === "string" ? candidate.message : undefined };
    }
    current = candidate.cause;
  }
  return null;
}

async function withLedgerErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const pg = pgCause(error);
    if (pg?.message && LEDGER_TRIGGER_MESSAGES.has(pg.message)) throw new DomainError(pg.message);
    if (pg) throw Object.assign(new Error(pg.message ?? "Database error"), { code: pg.code });
    throw error;
  }
}

function ledgerTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withLedgerErrors(() => db.transaction(fn));
}

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

// --- Catalog (organization-scoped) ---

export async function createUnit(
  actorId: string,
  organizationId: string,
  values: { name: string; abbreviation: string; dimension: "count" | "mass" | "volume" },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.manage_catalog");
    const [unit] = await tx
      .insert(unitsOfMeasure)
      .values({ organizationId, name: values.name, abbreviation: values.abbreviation, dimension: values.dimension, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.unit_created", entityType: "unit_of_measure", entityId: unit.id, requestId, newValues: { name: unit.name, abbreviation: unit.abbreviation, dimension: unit.dimension } });
    return unit;
  });
}

export async function createCategory(
  actorId: string,
  organizationId: string,
  values: { name: string; slug?: string; description?: string },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.manage_catalog");
    const slug = normalizeSlug(values.slug || values.name);
    if (!slug) throw new DomainError("VALIDATION_ERROR");
    const [category] = await tx
      .insert(inventoryCategories)
      .values({ organizationId, name: values.name, slug, description: values.description || null, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.category_created", entityType: "inventory_category", entityId: category.id, requestId, newValues: { name: category.name, slug: category.slug } });
    return category;
  });
}

export async function createItem(
  actorId: string,
  organizationId: string,
  values: { name: string; sku?: string; categoryId?: string | null; baseUnitId: string; tracksExpiration: boolean; notes?: string },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.manage_catalog");
    const [item] = await tx
      .insert(inventoryItems)
      .values({
        organizationId,
        categoryId: values.categoryId || null,
        name: values.name,
        sku: values.sku || null,
        baseUnitId: values.baseUnitId,
        tracksExpiration: values.tracksExpiration,
        notes: values.notes || null,
        createdBy: actorId,
      })
      .returning();
    // Every item carries an identity conversion for its own base unit (factor 1).
    await tx.insert(inventoryItemUnits).values({ organizationId, inventoryItemId: item.id, unitId: values.baseUnitId, factor: "1", roundingPolicy: "reject", isBaseUnit: true, isActive: true, createdBy: actorId });
    await writeAudit(tx, actorId, organizationId, { action: "inventory.item_created", entityType: "inventory_item", entityId: item.id, requestId, newValues: { name: item.name, sku: item.sku, baseUnitId: item.baseUnitId } });
    return item;
  });
}

export async function addItemUnit(
  actorId: string,
  organizationId: string,
  values: { itemId: string; unitId: string; factor: string; roundingPolicy: "reject" | "floor" | "ceiling" | "half_up" },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.manage_catalog");
    const [item] = await tx.select({ id: inventoryItems.id, baseUnitId: inventoryItems.baseUnitId }).from(inventoryItems).where(and(eq(inventoryItems.id, values.itemId), eq(inventoryItems.organizationId, organizationId))).limit(1);
    if (!item) throw new DomainError("NOT_FOUND");
    const isBaseUnit = item.baseUnitId === values.unitId;
    const [conversion] = await tx
      .insert(inventoryItemUnits)
      .values({ organizationId, inventoryItemId: values.itemId, unitId: values.unitId, factor: isBaseUnit ? "1" : values.factor, roundingPolicy: values.roundingPolicy, isBaseUnit, isActive: true, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.item_unit_added", entityType: "inventory_item_unit", entityId: conversion.id, requestId, newValues: { itemId: values.itemId, unitId: values.unitId, factor: conversion.factor } });
    return conversion;
  });
}

export async function archiveItem(actorId: string, organizationId: string, itemId: string, requestId: string) {
  return ledgerTransaction(async (tx) => {
    await requireOrgPermission(tx, actorId, organizationId, "inventory.manage_catalog");
    const [item] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.organizationId, organizationId))).limit(1);
    if (!item) throw new DomainError("NOT_FOUND");
    const [updated] = await tx.update(inventoryItems).set({ status: "archived", archivedAt: new Date() }).where(eq(inventoryItems.id, itemId)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.item_archived", entityType: "inventory_item", entityId: itemId, requestId, previousValues: { status: item.status }, newValues: { status: updated.status } });
    return updated;
  });
}

// --- Storage locations (location-scoped) ---

export async function createStorageLocation(
  actorId: string,
  organizationId: string,
  pantryLocationId: string,
  values: { name: string; code?: string; notes?: string },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "inventory.receive");
    const [storage] = await tx
      .insert(storageLocations)
      .values({ organizationId, pantryLocationId, name: values.name, code: values.code || null, notes: values.notes || null, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "inventory.storage_location_created", entityType: "storage_location", entityId: storage.id, locationId: pantryLocationId, requestId, newValues: { name: storage.name } });
    return storage;
  });
}

// --- Lots and ledger postings (location-scoped) ---

async function resolveItemConversion(tx: Transaction, organizationId: string, itemId: string, unitId: string) {
  const [conversion] = await tx
    .select({ factor: inventoryItemUnits.factor, roundingPolicy: inventoryItemUnits.roundingPolicy })
    .from(inventoryItemUnits)
    .where(and(eq(inventoryItemUnits.organizationId, organizationId), eq(inventoryItemUnits.inventoryItemId, itemId), eq(inventoryItemUnits.unitId, unitId), eq(inventoryItemUnits.isActive, true)))
    .limit(1);
  if (!conversion) throw new DomainError("MISSING_UNIT_CONVERSION");
  return conversion;
}

export async function createLot(
  actorId: string,
  organizationId: string,
  pantryLocationId: string,
  values: {
    itemId: string;
    storageLocationId?: string | null;
    lotCode?: string | null;
    receivedDate: string;
    bestByDate?: string | null;
    useByDate?: string | null;
    expirationDate?: string | null;
    notes?: string | null;
    opening?: { quantity: string; unitId: string } | null;
  },
  requestId: string,
) {
  return ledgerTransaction(async (tx) => {
    await requireLocationPermission(tx, actorId, pantryLocationId, "inventory.receive");
    const [item] = await tx.select({ id: inventoryItems.id, status: inventoryItems.status }).from(inventoryItems).where(and(eq(inventoryItems.id, values.itemId), eq(inventoryItems.organizationId, organizationId))).limit(1);
    if (!item) throw new DomainError("NOT_FOUND");
    if (item.status === "archived") throw new DomainError("ITEM_ARCHIVED");

    const [lot] = await tx
      .insert(inventoryLots)
      .values({
        organizationId,
        pantryLocationId,
        inventoryItemId: values.itemId,
        storageLocationId: values.storageLocationId || null,
        lotCode: values.lotCode || null,
        receivedDate: values.receivedDate,
        bestByDate: values.bestByDate || null,
        useByDate: values.useByDate || null,
        expirationDate: values.expirationDate || null,
        notes: values.notes || null,
        createdBy: actorId,
      })
      .returning();

    let openingTransactionId: string | null = null;
    if (values.opening) {
      const conversion = await resolveItemConversion(tx, organizationId, values.itemId, values.opening.unitId);
      const { base, roundingDelta } = resolveBaseQuantity(values.opening.quantity, conversion.factor, conversion.roundingPolicy);
      const membershipId = await actorMembership(tx, actorId, organizationId);
      const posted = await postInventoryTransaction(tx, {
        organizationId,
        pantryLocationId,
        inventoryItemId: values.itemId,
        inventoryLotId: lot.id,
        transactionType: "opening_balance",
        physicalDelta: base,
        inputQuantity: values.opening.quantity,
        inputUnitId: values.opening.unitId,
        conversionFactor: conversion.factor,
        roundingDelta,
        reasonCode: "opening_balance",
        reason: "Opening balance recorded during lot creation.",
        sourceType: "lot_creation",
        sourceReferenceId: lot.id,
        actorUserId: actorId,
        actorMembershipId: membershipId,
        requestId,
      });
      openingTransactionId = posted.id;
    }

    await writeAudit(tx, actorId, organizationId, { action: "inventory.lot_created", entityType: "inventory_lot", entityId: lot.id, locationId: pantryLocationId, requestId, newValues: { itemId: values.itemId, lotCode: lot.lotCode, expirationDate: lot.expirationDate, openingTransactionId } });
    return { lot, openingTransactionId };
  });
}

export async function recordAdjustment(
  actorId: string,
  organizationId: string,
  values: { lotId: string; direction: "positive" | "negative"; quantity: string; unitId: string; reasonCode: string; reason: string },
  requestId: string,
) {
  const result = await submitAdjustment(actorId, organizationId, { ...values, idempotencyKey: requestId }, requestId);
  return result.transaction ?? result.request;
}

export async function reverseTransaction(actorId: string, organizationId: string, transactionId: string, reason: string, requestId: string) {
  return ledgerTransaction(async (tx) => {
    const [target] = await tx
      .select({ id: inventoryTransactions.id, pantryLocationId: inventoryTransactions.pantryLocationId })
      .from(inventoryTransactions)
      .where(and(eq(inventoryTransactions.id, transactionId), eq(inventoryTransactions.organizationId, organizationId)))
      .limit(1);
    if (!target) throw new DomainError("REVERSAL_TARGET_NOT_FOUND");
    await requireLocationPermission(tx, actorId, target.pantryLocationId, "inventory.reverse");
    const membershipId = await actorMembership(tx, actorId, organizationId);

    const { reversal, original } = await reverseInventoryTransaction(tx, { transactionId, organizationId, actorUserId: actorId, actorMembershipId: membershipId, requestId, reason });
    await writeAudit(tx, actorId, organizationId, { action: "inventory.transaction_reversed", entityType: "inventory_transaction", entityId: reversal.id, locationId: original.pantryLocationId, requestId, reason, previousValues: { originalTransactionId: original.id, physicalDelta: original.physicalDelta }, newValues: { reversalTransactionId: reversal.id, physicalDelta: reversal.physicalDelta } });
    return { reversal, original };
  });
}
