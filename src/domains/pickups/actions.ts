"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { logServerError, mapProviderError } from "@/lib/errors";
import {
  appointmentSchema,
  consentSchema,
  contactSchema,
  fulfillmentLineSchema,
  householdSchema,
  packageLineSchema,
  packageTemplateSchema,
  parseOn,
  parseOptionalCount,
  preferenceSchema,
  reasonSchema,
  rescheduleSchema,
  sizeRuleSchema,
  substitutionSchema,
} from "@/domains/pickups/schemas";
import {
  addHouseholdContact,
  addHouseholdPreference,
  addPackageTemplateLine,
  addSizeRule,
  archiveHousehold,
  cancelAppointment,
  checkInAppointment,
  completePickup,
  correctPickupFulfillment,
  createAppointment,
  createHousehold,
  createPackageTemplate,
  createReservation,
  markNoShow,
  recordSmsConsent,
  releaseReservation,
  rescheduleAppointment,
  substituteReservationItem,
  updateHousehold,
  type FulfillmentLineInput,
} from "@/domains/pickups/service";
import { mergeHouseholds } from "@/domains/pickups/merge-service";

function validationFailure(requestId: string, message = "Review the entered information."): ActionResult {
  return { ok: false, code: "VALIDATION_ERROR", message, requestId };
}

function serviceFailure(scope: string, requestId: string, error: unknown) {
  const providerError = error instanceof Error ? { message: error.message, code: (error as { code?: string }).code } : {};
  logServerError(scope, requestId, providerError);
  return mapProviderError(providerError, requestId);
}

function combineDateTime(dateValue: string, timeValue: string) {
  return new Date(`${dateValue}T${timeValue}:00`);
}

export async function createHouseholdAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = householdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  let householdId: string;
  try {
    const household = await createHousehold(
      actor.id,
      organizationId,
      {
        displayName: parsed.data.displayName,
        preferredLanguage: parsed.data.preferredLanguage || undefined,
        householdSize: parsed.data.householdSize,
        adultCount: parseOptionalCount(parsed.data.adultCount),
        childCount: parseOptionalCount(parsed.data.childCount),
        seniorCount: parseOptionalCount(parsed.data.seniorCount),
        defaultPantryLocationId: parsed.data.defaultPantryLocationId || null,
        operationalNotes: parsed.data.operationalNotes || null,
        externalReference: parsed.data.externalReference || null,
      },
      requestId,
    );
    householdId = household.id;
  } catch (error) {
    return serviceFailure("household.create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households`);
  redirect(`/app/${organizationSlug}/households/${householdId}`);
}

export async function updateHouseholdAction(organizationId: string, organizationSlug: string, householdId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = householdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await updateHousehold(
      actor.id,
      organizationId,
      householdId,
      {
        displayName: parsed.data.displayName,
        preferredLanguage: parsed.data.preferredLanguage || undefined,
        householdSize: parsed.data.householdSize,
        adultCount: parseOptionalCount(parsed.data.adultCount),
        childCount: parseOptionalCount(parsed.data.childCount),
        seniorCount: parseOptionalCount(parsed.data.seniorCount),
        defaultPantryLocationId: parsed.data.defaultPantryLocationId || null,
        operationalNotes: parsed.data.operationalNotes || null,
        externalReference: parsed.data.externalReference || null,
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("household.update", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households/${householdId}`);
  return { ok: true, data: undefined, message: "Household updated.", requestId };
}

export async function archiveHouseholdAction(organizationId: string, organizationSlug: string, householdId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId, "A reason is required to archive a household.");
  try {
    await archiveHousehold(actor.id, organizationId, householdId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("household.archive", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households`);
  revalidatePath(`/app/${organizationSlug}/households/${householdId}`);
  return { ok: true, data: undefined, message: "Household archived.", requestId };
}

export async function mergeHouseholdAction(organizationId: string, organizationSlug: string, sourceHouseholdId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const targetHouseholdId = String(formData.get("targetHouseholdId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!targetHouseholdId || !reason.trim()) return validationFailure(requestId, "Choose a target household and provide a merge reason.");
  try { await mergeHouseholds(actor.id, organizationId, sourceHouseholdId, targetHouseholdId, reason, requestId); }
  catch (error) { return serviceFailure("household.merge", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/households`);
  redirect(`/app/${organizationSlug}/households/${targetHouseholdId}`);
}

export async function addContactAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await addHouseholdContact(
      actor.id,
      organizationId,
      parsed.data.householdId,
      {
        contactType: parsed.data.contactType,
        name: parsed.data.name,
        relationshipLabel: parsed.data.relationshipLabel || null,
        phoneNumber: parsed.data.phoneNumber || null,
        email: parsed.data.email || null,
        isAuthorizedPickup: parseOn(formData.get("isAuthorizedPickup")),
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("household.contact", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households/${parsed.data.householdId}`);
  return { ok: true, data: undefined, message: "Contact added.", requestId };
}

export async function addPreferenceAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = preferenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await addHouseholdPreference(actor.id, organizationId, parsed.data.householdId, { preferenceType: parsed.data.preferenceType, valueCode: parsed.data.valueCode, displayLabel: parsed.data.displayLabel, severity: parsed.data.severity, notes: parsed.data.notes || null }, requestId);
  } catch (error) {
    return serviceFailure("household.preference", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households/${parsed.data.householdId}`);
  return { ok: true, data: undefined, message: "Preference recorded.", requestId };
}

export async function recordConsentAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = consentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await recordSmsConsent(actor.id, organizationId, parsed.data.householdId, { householdContactId: parsed.data.householdContactId || null, phoneNumber: parsed.data.phoneNumber, status: parsed.data.status, consentSource: parsed.data.consentSource, notes: parsed.data.notes || null }, requestId);
  } catch (error) {
    return serviceFailure("consent.record", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/households/${parsed.data.householdId}`);
  return { ok: true, data: undefined, message: "Consent recorded. No SMS was sent.", requestId };
}

export async function createTemplateAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = packageTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await createPackageTemplate(actor.id, organizationId, { name: parsed.data.name, description: parsed.data.description || null, packageType: parsed.data.packageType, allowSubstitutions: parseOn(formData.get("allowSubstitutions")) }, requestId);
  } catch (error) {
    return serviceFailure("package.template", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/packages`);
  return { ok: true, data: undefined, message: "Package template created.", requestId };
}

export async function addTemplateLineAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = packageLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await addPackageTemplateLine(actor.id, organizationId, parsed.data.templateId, { lineType: parsed.data.lineType, inventoryItemId: parsed.data.inventoryItemId || null, inventoryCategoryId: parsed.data.inventoryCategoryId || null, baseQuantity: parsed.data.baseQuantity, isRequired: parseOn(formData.get("isRequired")), allowSubstitution: parseOn(formData.get("allowSubstitution")), priority: parsed.data.priority }, requestId);
  } catch (error) {
    return serviceFailure("package.line", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/packages`);
  return { ok: true, data: undefined, message: "Template line added.", requestId };
}

export async function addSizeRuleAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = sizeRuleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await addSizeRule(actor.id, organizationId, parsed.data.templateId, { minimumHouseholdSize: parsed.data.minimumHouseholdSize, maximumHouseholdSize: parseOptionalCount(parsed.data.maximumHouseholdSize), quantityMultiplier: parsed.data.quantityMultiplier }, requestId);
  } catch (error) {
    return serviceFailure("package.size_rule", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/packages`);
  return { ok: true, data: undefined, message: "Size rule added.", requestId };
}

export async function createAppointmentAction(organizationId: string, organizationSlug: string, pantryLocationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = appointmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  let appointmentId: string;
  let conflictCount = 0;
  try {
    const result = await createAppointment(
      actor.id,
      organizationId,
      {
        householdId: parsed.data.householdId,
        pantryLocationId,
        appointmentType: parsed.data.appointmentType,
        scheduledStartAt: combineDateTime(parsed.data.date, parsed.data.startTime),
        scheduledEndAt: combineDateTime(parsed.data.date, parsed.data.endTime),
        packageTemplateId: parsed.data.packageTemplateId || null,
        specialInstructions: parsed.data.specialInstructions || null,
        generateAllocation: Boolean(parsed.data.packageTemplateId),
        reserve: parseOn(formData.get("reserve")),
        checkInImmediately: parsed.data.appointmentType === "walk_in" && parseOn(formData.get("walkInCheckIn")),
      },
      requestId,
    );
    appointmentId = result.appointment.id;
    conflictCount = result.reservation?.conflicts.length ?? 0;
  } catch (error) {
    return serviceFailure("appointment.create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  if (conflictCount > 0) {
    redirect(`/app/${organizationSlug}/pickups/appointments/${appointmentId}?conflicts=1`);
  }
  redirect(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
}

export async function reserveAppointmentAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  void formData;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    const result = await createReservation(actor.id, organizationId, appointmentId, { idempotencyKey: crypto.randomUUID() }, requestId);
    revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
    if (!result.reservation) {
      const summary = result.conflicts.map((conflict) => `${conflict.itemName}: short ${conflict.shortage}`).join("; ");
      return { ok: false, code: "CONFLICT", message: `Reservation blocked by insufficient stock — ${summary}`, requestId };
    }
    return { ok: true, data: undefined, message: result.conflicts.length > 0 ? "Reserved with optional-line shortages noted." : "Inventory reserved.", requestId };
  } catch (error) {
    return serviceFailure("reservation.create", requestId, error);
  }
}

export async function releaseReservationAction(organizationId: string, organizationSlug: string, reservationId: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId, "A reason is required to release a reservation.");
  try {
    await releaseReservation(actor.id, organizationId, reservationId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("reservation.release", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  return { ok: true, data: undefined, message: "Reservation released.", requestId };
}

export async function substituteAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = substitutionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await substituteReservationItem(actor.id, organizationId, parsed.data.reservationLineId, parsed.data.substituteItemId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("pickup.substitute", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  return { ok: true, data: undefined, message: "Substitution recorded.", requestId };
}

export async function checkInAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  void formData;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    await checkInAppointment(actor.id, organizationId, appointmentId, requestId);
  } catch (error) {
    return serviceFailure("appointment.check_in", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  return { ok: true, data: undefined, message: "Checked in.", requestId };
}

export async function completePickupAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(idempotencyKey)) return validationFailure(requestId);
  const lines: FulfillmentLineInput[] = [];
  const lineCount = Number(formData.get("lineCount") ?? "0");
  for (let index = 0; index < lineCount; index += 1) {
    const quantityRaw = String(formData.get(`line-${index}-quantity`) ?? "").trim();
    if (!quantityRaw || Number(quantityRaw) === 0) continue; // explicitly not provided
    const parsed = fulfillmentLineSchema.safeParse({
      reservationLineId: formData.get(`line-${index}-reservationLineId`),
      inventoryLotId: formData.get(`line-${index}-lotId`),
      quantity: quantityRaw,
    });
    if (!parsed.success) return validationFailure(requestId, "Review the fulfillment quantities.");
    lines.push(parsed.data);
  }
  try {
    await completePickup(actor.id, organizationId, appointmentId, { lines, notes: String(formData.get("notes") ?? "") || null, idempotencyKey }, requestId);
  } catch (error) {
    return serviceFailure("pickup.complete", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  revalidatePath(`/app/${organizationSlug}/inventory`);
  return { ok: true, data: undefined, message: "Pickup completed and inventory posted.", requestId };
}

export async function cancelAppointmentAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId, "A cancellation reason is required.");
  try {
    await cancelAppointment(actor.id, organizationId, appointmentId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("appointment.cancel", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  return { ok: true, data: undefined, message: "Appointment cancelled and reservation released.", requestId };
}

export async function markNoShowAction(organizationId: string, organizationSlug: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId, "A short note is required.");
  try {
    await markNoShow(actor.id, organizationId, appointmentId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("appointment.no_show", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  return { ok: true, data: undefined, message: "Marked as no-show. Reserved inventory released.", requestId };
}

export async function rescheduleAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  let replacementId: string;
  try {
    const result = await rescheduleAppointment(actor.id, organizationId, parsed.data.appointmentId, { scheduledStartAt: combineDateTime(parsed.data.date, parsed.data.startTime), scheduledEndAt: combineDateTime(parsed.data.date, parsed.data.endTime) }, requestId);
    replacementId = result.replacement.id;
  } catch (error) {
    return serviceFailure("appointment.reschedule", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups`);
  redirect(`/app/${organizationSlug}/pickups/appointments/${replacementId}`);
}

export async function correctFulfillmentAction(organizationId: string, organizationSlug: string, fulfillmentId: string, appointmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId, "A correction reason is required.");
  try {
    await correctPickupFulfillment(actor.id, organizationId, fulfillmentId, parsed.data.reason, requestId);
  } catch (error) {
    return serviceFailure("pickup.correct", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/pickups/appointments/${appointmentId}`);
  revalidatePath(`/app/${organizationSlug}/inventory`);
  return { ok: true, data: undefined, message: "Pickup corrected. Ledger reversals posted.", requestId };
}
