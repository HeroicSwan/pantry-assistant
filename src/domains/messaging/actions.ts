"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { logServerError, mapProviderError } from "@/lib/errors";
import { campaignSchema, individualMessageSchema, messageTemplateSchema, messagingSettingsSchema } from "@/domains/messaging/schemas";
import { archiveMessageTemplate, createMessageCampaign, createMessageTemplate, markInboundHandled, retryFailedMessage, saveMessagingSettings, sendIndividualMessage, sendMessageCampaign, transitionMessageCampaign, updateMessageTemplate } from "@/domains/messaging/service";

function failure(scope: string, requestId: string, error: unknown): ActionResult {
  const provider = error instanceof Error ? { message: error.message, code: (error as { code?: string }).code } : {};
  logServerError(scope, requestId, provider);
  return mapProviderError(provider, requestId);
}

const success = (message: string, requestId: string): ActionResult => ({ ok: true, data: undefined, message, requestId });

export async function createMessageTemplateAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = messageTemplateSchema.safeParse({ name: formData.get("name"), templateType: formData.get("templateType"), language: formData.get("language"), body: formData.get("body") });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the template fields.", requestId };
  try {
    await createMessageTemplate(actor.id, organizationId, locationId, parsed.data, requestId);
    revalidatePath(`/app/${organizationSlug}/messages/templates`);
    return success("Message template created.", requestId);
  } catch (error) { return failure("message.template.create", requestId, error); }
}

export async function archiveMessageTemplateAction(organizationId: string, organizationSlug: string, locationId: string, templateId: string, _state: ActionResult): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  try { await archiveMessageTemplate(actor.id, organizationId, locationId, templateId, requestId); revalidatePath(`/app/${organizationSlug}/messages/templates`); return success("Template archived.", requestId); }
  catch (error) { return failure("message.template.archive", requestId, error); }
}

export async function updateMessageTemplateAction(organizationId: string, organizationSlug: string, locationId: string, templateId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  const parsed = messageTemplateSchema.safeParse({ name: formData.get("name"), templateType: formData.get("templateType"), language: formData.get("language"), body: formData.get("body") });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the template fields.", requestId };
  try { await updateMessageTemplate(actor.id, organizationId, locationId, templateId, parsed.data, requestId); revalidatePath(`/app/${organizationSlug}/messages/templates`); return success("Template updated. Existing message snapshots were unchanged.", requestId); }
  catch (error) { return failure("message.template.update", requestId, error); }
}

export async function sendIndividualMessageAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  const parsed = individualMessageSchema.safeParse({ contactId: formData.get("contactId"), body: formData.get("body"), language: formData.get("language") || "en", scheduledFor: formData.get("scheduledFor") || undefined, idempotencyKey: formData.get("idempotencyKey"), confirmed: formData.get("confirmed") });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the recipient, message, and confirmation.", requestId };
  try {
    await sendIndividualMessage(actor.id, organizationId, locationId, { ...parsed.data, scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null, confirmed: true }, requestId);
    revalidatePath(`/app/${organizationSlug}/messages`); revalidatePath(`/app/${organizationSlug}/messages/history`);
    return success(parsed.data.scheduledFor ? "Message scheduled." : "Message processed by the configured provider.", requestId);
  } catch (error) { return failure("message.individual.send", requestId, error); }
}

export async function createMessageCampaignAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  const parsed = campaignSchema.safeParse({ name: formData.get("name"), campaignType: formData.get("campaignType") || "bulk_announcement", body: formData.get("body"), appointmentDate: formData.get("appointmentDate") || undefined, appointmentStatus: formData.get("appointmentStatus") || undefined, preferredLanguage: formData.get("preferredLanguage") || undefined, scheduledFor: formData.get("scheduledFor") || undefined, idempotencyKey: formData.get("idempotencyKey") });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the campaign fields.", requestId };
  try {
    await createMessageCampaign(actor.id, organizationId, locationId, { name: parsed.data.name, campaignType: parsed.data.campaignType, body: parsed.data.body, audience: { appointmentDate: parsed.data.appointmentDate, appointmentStatus: parsed.data.appointmentStatus, preferredLanguage: parsed.data.preferredLanguage }, scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null, idempotencyKey: parsed.data.idempotencyKey }, requestId);
    revalidatePath(`/app/${organizationSlug}/messages/campaigns`); return success("Campaign draft created.", requestId);
  } catch (error) { return failure("message.campaign.create", requestId, error); }
}

export async function transitionMessageCampaignAction(organizationId: string, organizationSlug: string, locationId: string, campaignId: string, target: "awaiting_approval" | "approved" | "cancelled", _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  try { await transitionMessageCampaign(actor.id, organizationId, locationId, campaignId, target, String(formData.get("reason") ?? "") || null, requestId); revalidatePath(`/app/${organizationSlug}/messages/campaigns`); revalidatePath(`/app/${organizationSlug}/messages/campaigns/${campaignId}`); return success(`Campaign ${target.replaceAll("_", " ")}.`, requestId); }
  catch (error) { return failure("message.campaign.transition", requestId, error); }
}

export async function sendMessageCampaignAction(organizationId: string, organizationSlug: string, locationId: string, campaignId: string, _state: ActionResult): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  try { const result = await sendMessageCampaign(actor.id, organizationId, locationId, campaignId, requestId); revalidatePath(`/app/${organizationSlug}/messages`); revalidatePath(`/app/${organizationSlug}/messages/campaigns`); revalidatePath(`/app/${organizationSlug}/messages/campaigns/${campaignId}`); return success(`Campaign processed: ${result.total} recipients, ${result.excluded} excluded.`, requestId); }
  catch (error) { return failure("message.campaign.send", requestId, error); }
}

export async function retryFailedMessageAction(organizationId: string, organizationSlug: string, locationId: string, messageId: string, _state: ActionResult): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  try { await retryFailedMessage(actor.id, organizationId, locationId, messageId, requestId); revalidatePath(`/app/${organizationSlug}/messages/history`); return success("Retry processed after consent revalidation.", requestId); }
  catch (error) { return failure("message.retry", requestId, error); }
}

export async function markInboundHandledAction(organizationId: string, organizationSlug: string, locationId: string, inboundId: string, _state: ActionResult): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  try { await markInboundHandled(actor.id, organizationId, locationId, inboundId, requestId); revalidatePath(`/app/${organizationSlug}/messages/inbound`); return success("Inbound message marked handled.", requestId); }
  catch (error) { return failure("message.inbound.handle", requestId, error); }
}

export async function saveMessagingSettingsAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  void _state;
  const requestId = crypto.randomUUID(); const actor = await requireUser();
  const parsed = messagingSettingsSchema.safeParse({ sendingMode: formData.get("sendingMode"), defaultFromNumber: formData.get("defaultFromNumber") || undefined, defaultLanguage: formData.get("defaultLanguage") || "en", quietHoursStart: formData.get("quietHoursStart") || undefined, quietHoursEnd: formData.get("quietHoursEnd") || undefined, reminderHoursBefore: formData.get("reminderHoursBefore"), retryLimit: formData.get("retryLimit"), helpResponse: formData.get("helpResponse"), isEnabled: formData.get("isEnabled") === "on", confirmLive: formData.get("confirmLive") === "on" });
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the messaging settings.", requestId };
  try { await saveMessagingSettings(actor.id, organizationId, locationId, parsed.data, requestId); revalidatePath(`/app/${organizationSlug}/messages/settings`); return success("Messaging settings saved.", requestId); }
  catch (error) { return failure("message.settings.save", requestId, error); }
}
