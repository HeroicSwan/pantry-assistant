"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { DomainError, logServerError, mapProviderError } from "@/lib/errors";
import {
  acknowledgeAlertProposalInputSchema,
  assistantPromptSchema,
  conversationTitleSchema,
  donationNeedsReportInputSchema,
  draftBulkAnnouncementInputSchema,
  draftSmsMessageInputSchema,
  inventoryAdjustmentProposalInputSchema,
  pickupRescheduleProposalInputSchema,
  reservationProposalInputSchema,
} from "@/domains/assistant/schemas";
import {
  confirmProposal,
  createAlertAcknowledgementProposal,
  createConversation,
  createDonationNeedsReportProposal,
  createDraftBulkAnnouncementProposal,
  createDraftSmsMessageProposal,
  createInventoryAdjustmentProposal,
  createPickupRescheduleProposal,
  createReservationProposal,
  runAssistantTurn,
} from "@/domains/assistant/service";

function failure(scope: string, requestId: string, error: unknown): ActionResult {
  if (error instanceof DomainError) {
    if (error.message === "FORBIDDEN")
      return { ok: false, code: "FORBIDDEN", message: "You do not have permission to use this assistant operation.", requestId };
    if (error.message === "NOT_FOUND")
      return { ok: false, code: "NOT_FOUND", message: "The scoped assistant record was not found.", requestId };
    if (error.message === "CONFLICT")
      return { ok: false, code: "CONFLICT", message: "The proposal is expired, stale, or no longer valid. Create a fresh proposal.", requestId };
  }
  const provider = error instanceof Error ? { message: error.message, code: (error as { code?: string }).code } : {};
  logServerError(scope, requestId, provider);
  return mapProviderError(provider, requestId);
}

function idempotencyKeyFrom(formData: FormData) {
  const value = formData.get("idempotencyKey");
  return typeof value === "string" && value ? value : crypto.randomUUID();
}

export async function createConversationAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = conversationTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a conversation title between 2 and 120 characters.", requestId };
  let conversationId: string;
  try {
    const conversation = await createConversation({ actorId: actor.id, organizationId, locationId, requestId }, parsed.data);
    conversationId = conversation.id;
  } catch (error) {
    return failure("assistant.conversation.create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/assistant`);
  redirect(`/app/${organizationSlug}/assistant/${conversationId}`);
}

export async function submitAssistantPromptAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = assistantPromptSchema.safeParse(formData.get("prompt"));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a question between 2 and 1,000 characters.", requestId };
  try {
    await runAssistantTurn({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Scoped assistant query completed.", requestId };
  } catch (error) {
    return failure("assistant.turn", requestId, error);
  }
}

export async function createAlertProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = acknowledgeAlertProposalInputSchema.safeParse({ alertId: formData.get("alertId"), reason: formData.get("reason"), idempotencyKey: idempotencyKeyFrom(formData) });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Select an open alert and enter a review reason.", requestId };
  try {
    await createAlertAcknowledgementProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Proposal created. No alert was changed.", requestId };
  } catch (error) {
    return failure("assistant.proposal.create", requestId, error);
  }
}

export async function draftSmsMessageProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = draftSmsMessageInputSchema.safeParse({ body: formData.get("body"), purpose: formData.get("purpose") || undefined, idempotencyKey: idempotencyKeyFrom(formData) });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a message body between 3 and 480 characters.", requestId };
  try {
    await createDraftSmsMessageProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Draft saved for review. Nothing was sent.", requestId };
  } catch (error) {
    return failure("assistant.proposal.draft_sms", requestId, error);
  }
}

export async function draftBulkAnnouncementProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = draftBulkAnnouncementInputSchema.safeParse({ name: formData.get("name"), body: formData.get("body"), idempotencyKey: idempotencyKeyFrom(formData) });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a campaign name and message body.", requestId };
  try {
    await createDraftBulkAnnouncementProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Draft announcement saved for review. Nothing was sent.", requestId };
  } catch (error) {
    return failure("assistant.proposal.draft_bulk", requestId, error);
  }
}

export async function createInventoryAdjustmentProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = inventoryAdjustmentProposalInputSchema.safeParse({
    lotId: formData.get("lotId"),
    direction: formData.get("direction"),
    quantity: formData.get("quantity"),
    reasonCode: formData.get("reasonCode"),
    reason: formData.get("reason"),
    idempotencyKey: idempotencyKeyFrom(formData),
  });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the lot, quantity, and reason. The unit is resolved automatically from the lot's item.", requestId };
  try {
    await createInventoryAdjustmentProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Proposal created. No inventory was changed.", requestId };
  } catch (error) {
    return failure("assistant.proposal.inventory_adjustment", requestId, error);
  }
}

export async function createReservationProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reservationProposalInputSchema.safeParse({ appointmentId: formData.get("appointmentId"), idempotencyKey: idempotencyKeyFrom(formData) });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Select an appointment.", requestId };
  try {
    await createReservationProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Proposal created. No inventory was reserved yet.", requestId };
  } catch (error) {
    return failure("assistant.proposal.reservation", requestId, error);
  }
}

export async function createDonationNeedsReportProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = donationNeedsReportInputSchema.safeParse({ horizonDays: formData.get("horizonDays") ? Number(formData.get("horizonDays")) : undefined, idempotencyKey: idempotencyKeyFrom(formData) });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a horizon between 1 and 90 days.", requestId };
  try {
    await createDonationNeedsReportProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Report proposal created.", requestId };
  } catch (error) {
    return failure("assistant.proposal.donation_needs", requestId, error);
  }
}

export async function createPickupRescheduleProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  _state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = pickupRescheduleProposalInputSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    scheduledStartAt: formData.get("scheduledStartAt"),
    scheduledEndAt: formData.get("scheduledEndAt"),
    idempotencyKey: idempotencyKeyFrom(formData),
  });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Select an appointment and a valid new start/end time.", requestId };
  try {
    await createPickupRescheduleProposal({ actorId: actor.id, organizationId, locationId, requestId }, conversationId, parsed.data);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return { ok: true, data: undefined, message: "Reschedule proposal created. The appointment is unchanged.", requestId };
  } catch (error) {
    return failure("assistant.proposal.reschedule", requestId, error);
  }
}

export async function confirmProposalAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  conversationId: string,
  proposalId: string,
  _state: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  void _state;
  void _formData;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    await confirmProposal({ actorId: actor.id, organizationId, locationId, requestId }, proposalId);
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    revalidatePath(`/app/${organizationSlug}/alerts`);
    revalidatePath(`/app/${organizationSlug}/inventory`);
    revalidatePath(`/app/${organizationSlug}/pickups`);
    revalidatePath(`/app/${organizationSlug}/messages`);
    return { ok: true, data: undefined, message: "Proposal confirmed and executed once.", requestId };
  } catch (error) {
    return failure("assistant.proposal.confirm", requestId, error);
  }
}
