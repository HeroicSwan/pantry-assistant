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
} from "@/domains/assistant/schemas";
import {
  confirmProposal,
  createAlertAcknowledgementProposal,
  createConversation,
  runAssistantTurn,
} from "@/domains/assistant/service";

function failure(
  scope: string,
  requestId: string,
  error: unknown,
): ActionResult {
  if (error instanceof DomainError) {
    if (error.message === "FORBIDDEN")
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "You do not have permission to use this assistant operation.",
        requestId,
      };
    if (error.message === "NOT_FOUND")
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "The scoped assistant record was not found.",
        requestId,
      };
    if (error.message === "CONFLICT")
      return {
        ok: false,
        code: "CONFLICT",
        message:
          "The proposal is expired, stale, or no longer valid. Create a fresh proposal.",
        requestId,
      };
  }
  const provider =
    error instanceof Error
      ? { message: error.message, code: (error as { code?: string }).code }
      : {};
  logServerError(scope, requestId, provider);
  return mapProviderError(provider, requestId);
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
  if (!parsed.success)
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Enter a conversation title between 2 and 120 characters.",
      requestId,
    };
  let conversationId: string;
  try {
    const conversation = await createConversation(
      { actorId: actor.id, organizationId, locationId, requestId },
      parsed.data,
    );
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
  if (!parsed.success)
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Enter a question between 2 and 1,000 characters.",
      requestId,
    };
  try {
    await runAssistantTurn(
      { actorId: actor.id, organizationId, locationId, requestId },
      conversationId,
      parsed.data,
    );
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return {
      ok: true,
      data: undefined,
      message: "Scoped assistant query completed.",
      requestId,
    };
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
  const parsed = acknowledgeAlertProposalInputSchema.safeParse({
    alertId: formData.get("alertId"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success)
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Select an open alert and enter a review reason.",
      requestId,
    };
  try {
    await createAlertAcknowledgementProposal(
      { actorId: actor.id, organizationId, locationId, requestId },
      conversationId,
      parsed.data,
    );
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    return {
      ok: true,
      data: undefined,
      message: "Proposal created. No alert was changed.",
      requestId,
    };
  } catch (error) {
    return failure("assistant.proposal.create", requestId, error);
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
    await confirmProposal(
      { actorId: actor.id, organizationId, locationId, requestId },
      proposalId,
    );
    revalidatePath(`/app/${organizationSlug}/assistant/${conversationId}`);
    revalidatePath(`/app/${organizationSlug}/alerts`);
    return {
      ok: true,
      data: undefined,
      message: "Proposal confirmed and executed once.",
      requestId,
    };
  } catch (error) {
    return failure("assistant.proposal.confirm", requestId, error);
  }
}
