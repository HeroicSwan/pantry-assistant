"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { logServerError, mapProviderError } from "@/lib/errors";
import {
  addReceivingLine,
  approveAdjustment,
  approveCycleCount,
  approveTransfer,
  archiveDonor,
  cancelReceiving,
  cancelTransfer,
  completeReceiving,
  correctTransaction,
  createDonation,
  createDonor,
  createPurchasedShipment,
  createRecall,
  createTransfer,
  dispatchTransfer,
  enterCycleCount,
  placeQuarantine,
  receiveTransferLine,
  reconcileCycleCount,
  recordConditionRemoval,
  rejectAdjustment,
  releaseQuarantine,
  requestTransfer,
  resolveRecall,
  resolveTransferDiscrepancy,
  startCycleCount,
  startReceiving,
  submitAdjustment,
  submitCycleCount,
  updateDonor,
} from "@/domains/inventory/operations-service";

const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(500);
const quantity = z.string().regex(/^\d+(\.\d{1,6})?$/).refine((value) => Number(value) > 0);

function fail(requestId: string, error: unknown): ActionResult {
  const providerError = error instanceof Error ? { message: error.message, code: (error as { code?: string }).code } : {};
  logServerError("inventory.operations", requestId, providerError);
  return mapProviderError(providerError, requestId);
}

function invalid(requestId: string): ActionResult {
  return { ok: false, code: "VALIDATION_ERROR", message: "Review the entered information.", requestId };
}

async function actorId() {
  return (await requireUser()).id;
}

function refresh(slug: string, path = "") {
  revalidatePath(`/app/${slug}/inventory${path}`);
  revalidatePath(`/app/${slug}/inventory`);
}

export async function createDonorAction(organizationId: string, slug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ donorType: z.enum(["individual", "business", "nonprofit", "government", "food_bank", "grocery_store", "farm", "religious_organization", "school", "anonymous", "other"]), name: text, contactName: z.string().trim().max(120).optional(), email: z.string().email().optional().or(z.literal("")), phoneNumber: z.string().trim().max(40).optional(), notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  try { await createDonor(await actorId(), organizationId, parsed.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/donors");
  return { ok: true, data: undefined, message: "Donor created.", requestId };
}

export async function updateDonorAction(organizationId: string, slug: string, donorId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ name: text, contactName: z.string().trim().max(120).optional(), email: z.string().email().optional().or(z.literal("")), phoneNumber: z.string().trim().max(40).optional(), notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  try { await updateDonor(await actorId(), organizationId, donorId, parsed.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/donors/${donorId}`);
  return { ok: true, data: undefined, message: "Donor updated.", requestId };
}

export async function archiveDonorAction(organizationId: string, slug: string, donorId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const reason = z.string().trim().min(3).max(500).safeParse(formData.get("reason"));
  if (!reason.success) return invalid(requestId);
  try { await archiveDonor(await actorId(), organizationId, donorId, reason.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/donors");
  return { ok: true, data: undefined, message: "Donor archived.", requestId };
}

export async function createDonationAction(organizationId: string, slug: string, locationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ donationNumber: text, donorId: uuid.optional().or(z.literal("")), donationDate: z.string().date(), itemId: uuid.optional().or(z.literal("")), expectedQuantity: quantity.optional().or(z.literal("")), unitId: uuid.optional().or(z.literal("")), notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  const hasLine = Boolean(parsed.data.itemId && parsed.data.expectedQuantity && parsed.data.unitId);
  try { await createDonation(await actorId(), organizationId, locationId, { donationNumber: parsed.data.donationNumber, donorId: parsed.data.donorId || null, donationDate: parsed.data.donationDate, notes: parsed.data.notes, lines: hasLine ? [{ itemId: parsed.data.itemId as string, quantity: parsed.data.expectedQuantity, unitId: parsed.data.unitId }] : [] }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/receiving");
  return { ok: true, data: undefined, message: "Donation intake created.", requestId };
}

export async function createPurchasedShipmentAction(organizationId: string, slug: string, locationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ supplierName: text, supplierReference: z.string().trim().max(120).optional(), notes: z.string().trim().max(1000).optional(), inventoryItemId: uuid.optional().or(z.literal("")), expectedQuantity: quantity.optional().or(z.literal("")), expectedUnitId: uuid.optional().or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  const hasLine = Boolean(parsed.data.inventoryItemId && parsed.data.expectedQuantity && parsed.data.expectedUnitId);
  try { await createPurchasedShipment(await actorId(), organizationId, locationId, { supplierName: parsed.data.supplierName, supplierReference: parsed.data.supplierReference, notes: parsed.data.notes, line: hasLine ? { inventoryItemId: parsed.data.inventoryItemId as string, expectedQuantity: parsed.data.expectedQuantity as string, expectedUnitId: parsed.data.expectedUnitId as string } : null }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/receiving");
  return { ok: true, data: undefined, message: "Purchased shipment created.", requestId };
}

export async function startReceivingAction(organizationId: string, slug: string, locationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ sourceType: z.enum(["donation", "purchase", "other"]), donationId: uuid.optional().or(z.literal("")), purchasedShipmentId: uuid.optional().or(z.literal("")), notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || (parsed.data.sourceType === "donation" && !parsed.data.donationId) || (parsed.data.sourceType === "purchase" && !parsed.data.purchasedShipmentId)) return invalid(requestId);
  try { await startReceiving(await actorId(), organizationId, locationId, { sourceType: parsed.data.sourceType, donationId: parsed.data.sourceType === "donation" ? parsed.data.donationId || null : null, purchasedShipmentId: parsed.data.sourceType === "purchase" ? parsed.data.purchasedShipmentId || null : null, idempotencyKey: requestId, notes: parsed.data.notes }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/receiving");
  return { ok: true, data: undefined, message: "Receiving session started.", requestId };
}

export async function addReceivingLineAction(organizationId: string, slug: string, sessionId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ itemId: uuid, existingLotId: uuid.optional().or(z.literal("")), quantity, unitId: uuid, lotNumber: z.string().trim().max(120).optional(), receivedDate: z.string().date(), bestByDate: z.string().date().optional().or(z.literal("")), expirationDate: z.string().date().optional().or(z.literal("")), notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  try { await addReceivingLine(await actorId(), organizationId, sessionId, { ...parsed.data, existingLotId: parsed.data.existingLotId || null, bestByDate: parsed.data.bestByDate || null, expirationDate: parsed.data.expirationDate || null }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/receiving/${sessionId}`);
  return { ok: true, data: undefined, message: "Receiving line added.", requestId };
}

export async function completeReceivingAction(organizationId: string, slug: string, sessionId: string, _: ActionResult, _formData: FormData): Promise<ActionResult> {
  void _; void _formData;
  const requestId = crypto.randomUUID();
  try { await completeReceiving(await actorId(), organizationId, sessionId, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/receiving/${sessionId}`);
  return { ok: true, data: undefined, message: "Receiving completed and stock posted.", requestId };
}

export async function cancelReceivingAction(organizationId: string, slug: string, sessionId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const reason = text.safeParse(formData.get("reason")); if (!reason.success) return invalid(requestId);
  try { await cancelReceiving(await actorId(), organizationId, sessionId, reason.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/receiving/${sessionId}`); return { ok: true, data: undefined, message: "Receiving cancelled.", requestId };
}

export async function submitAdjustmentAction(organizationId: string, slug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ lotId: uuid, direction: z.enum(["positive", "negative"]), quantity, unitId: uuid, reasonCode: text, reason: text }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { const result = await submitAdjustment(await actorId(), organizationId, { ...parsed.data, idempotencyKey: requestId }, requestId); refresh(slug, "/adjustments"); return { ok: true, data: undefined, message: result.transaction ? "Adjustment posted." : "High-risk adjustment submitted for approval.", requestId }; } catch (error) { return fail(requestId, error); }
}

export async function correctTransactionAction(organizationId: string, slug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = z.object({ transactionId: uuid, direction: z.enum(["positive", "negative"]), quantity, unitId: uuid, reasonCode: text, reason: text }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(requestId);
  try { await correctTransaction(await actorId(), organizationId, parsed.data.transactionId, parsed.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/adjustments");
  refresh(slug, "/activity");
  return { ok: true, data: undefined, message: "Transaction corrected with a reversal and replacement.", requestId };
}

export async function decideAdjustmentAction(organizationId: string, slug: string, adjustmentId: string, decision: "approve" | "reject", _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const reason = text.safeParse(formData.get("reason")); if (!reason.success) return invalid(requestId);
  try { if (decision === "approve") await approveAdjustment(await actorId(), organizationId, adjustmentId, reason.data, requestId); else await rejectAdjustment(await actorId(), organizationId, adjustmentId, reason.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/adjustments"); return { ok: true, data: undefined, message: `Adjustment ${decision}d.`, requestId };
}

export async function conditionRemovalAction(organizationId: string, slug: string, eventType: "spoilage" | "damage" | "expiration_removal" | "recall_disposal", _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ lotId: uuid, quantity, unitId: uuid, reason: text }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { await recordConditionRemoval(await actorId(), organizationId, { ...parsed.data, eventType, idempotencyKey: requestId }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/conditions"); return { ok: true, data: undefined, message: "Condition event posted.", requestId };
}

export async function quarantineAction(organizationId: string, slug: string, mode: "place" | "release", _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ lotId: uuid, reason: text }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { if (mode === "place") await placeQuarantine(await actorId(), organizationId, parsed.data.lotId, parsed.data.reason, requestId, requestId); else await releaseQuarantine(await actorId(), organizationId, parsed.data.lotId, parsed.data.reason, requestId, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/conditions"); return { ok: true, data: undefined, message: `Quarantine ${mode === "place" ? "placed" : "released"}.`, requestId };
}

export async function startCycleCountAction(organizationId: string, slug: string, locationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const notes = z.string().trim().max(1000).optional().safeParse(formData.get("notes") || undefined); if (!notes.success) return invalid(requestId);
  try { await startCycleCount(await actorId(), organizationId, locationId, notes.data ?? null, requestId, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/counts"); return { ok: true, data: undefined, message: "Cycle count started.", requestId };
}

export async function enterCycleCountAction(organizationId: string, slug: string, sessionId: string, entryId: string, unitId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ quantity: z.string().regex(/^\d+(\.\d{1,6})?$/), notes: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { await enterCycleCount(await actorId(), organizationId, sessionId, entryId, parsed.data.quantity, unitId, parsed.data.notes ?? null, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/counts/${sessionId}`); return { ok: true, data: undefined, message: "Count recorded.", requestId };
}

export async function cycleCountTransitionAction(organizationId: string, slug: string, sessionId: string, transition: "submit" | "approve" | "reconcile", _: ActionResult, _formData: FormData): Promise<ActionResult> {
  void _; void _formData;
  const requestId = crypto.randomUUID();
  try { if (transition === "submit") await submitCycleCount(await actorId(), organizationId, sessionId, requestId); else if (transition === "approve") await approveCycleCount(await actorId(), organizationId, sessionId, requestId); else await reconcileCycleCount(await actorId(), organizationId, sessionId, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/counts/${sessionId}`); return { ok: true, data: undefined, message: `Count ${transition} completed.`, requestId };
}

export async function createTransferAction(organizationId: string, slug: string, sourceLocationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ transferNumber: text, destinationLocationId: uuid, lotId: uuid, quantity, unitId: uuid, notes: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { await createTransfer(await actorId(), organizationId, { transferNumber: parsed.data.transferNumber, sourceLocationId, destinationLocationId: parsed.data.destinationLocationId, notes: parsed.data.notes, idempotencyKey: requestId, lines: [{ lotId: parsed.data.lotId, quantity: parsed.data.quantity, unitId: parsed.data.unitId }] }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/transfers"); return { ok: true, data: undefined, message: "Transfer draft created.", requestId };
}

export async function transferTransitionAction(organizationId: string, slug: string, transferId: string, transition: "request" | "approve" | "dispatch" | "cancel" | "resolve", _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const reason = String(formData.get("reason") ?? "").trim();
  try { const actor = await actorId(); if (transition === "request") await requestTransfer(actor, organizationId, transferId, requestId); else if (transition === "approve") await approveTransfer(actor, organizationId, transferId, requestId); else if (transition === "dispatch") await dispatchTransfer(actor, organizationId, transferId, requestId); else if (transition === "cancel") { if (!reason) return invalid(requestId); await cancelTransfer(actor, organizationId, transferId, reason, requestId); } else { if (!reason) return invalid(requestId); await resolveTransferDiscrepancy(actor, organizationId, transferId, reason, requestId); } } catch (error) { return fail(requestId, error); }
  refresh(slug, `/transfers/${transferId}`); return { ok: true, data: undefined, message: `Transfer ${transition} completed.`, requestId };
}

export async function receiveTransferLineAction(organizationId: string, slug: string, transferId: string, lineId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ quantity, unitId: uuid, discrepancyReason: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { await receiveTransferLine(await actorId(), organizationId, transferId, lineId, { ...parsed.data, idempotencyKey: requestId }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, `/transfers/${transferId}`); return { ok: true, data: undefined, message: "Transfer quantity received.", requestId };
}

export async function createRecallAction(organizationId: string, slug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const parsed = z.object({ referenceCode: text, title: text, description: text, lotId: uuid }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return invalid(requestId);
  try { await createRecall(await actorId(), organizationId, { referenceCode: parsed.data.referenceCode, title: parsed.data.title, description: parsed.data.description, lotIds: [parsed.data.lotId] }, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/conditions"); return { ok: true, data: undefined, message: "Recall activated.", requestId };
}

export async function resolveRecallAction(organizationId: string, slug: string, recallId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID(); const resolution = text.safeParse(formData.get("reason")); if (!resolution.success) return invalid(requestId);
  try { await resolveRecall(await actorId(), organizationId, recallId, resolution.data, requestId); } catch (error) { return fail(requestId, error); }
  refresh(slug, "/conditions"); return { ok: true, data: undefined, message: "Recall resolved.", requestId };
}
