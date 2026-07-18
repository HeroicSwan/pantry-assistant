"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { upsertAutomationPolicy } from "@/domains/automation/service";
import { saveAdvancedForecastSettings, saveCausalForecastEvent } from "@/domains/advanced/settings";
import { saveComplianceProfile } from "@/domains/compliance/service";

export async function saveAdvancedForecastAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await saveAdvancedForecastSettings({ actorId: user.id, organizationId, locationId, enabled: formData.get("enabled") === "on", seasonality: { weekday: String(formData.get("weekdayFactors") ?? "") }, mlParameters: { trend: true, causalEvents: true } });
    revalidatePath(`/app/${organizationSlug}/forecast/settings`);
    return { ok: true, data: undefined, message: "Advanced forecasting settings saved.", requestId: crypto.randomUUID() };
  } catch { return { ok: false, code: "FORBIDDEN", message: "You do not have permission to change advanced forecasting.", requestId: crypto.randomUUID() }; }
}

export async function saveAutomationPolicyAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const operation = String(formData.get("operation") ?? "purchase");
  if (!["purchase", "dispose", "transfer", "inventory_adjustment"].includes(operation)) return { ok: false, code: "VALIDATION_ERROR", message: "Invalid automation operation.", requestId: crypto.randomUUID() };
  try { await upsertAutomationPolicy(user.id, organizationId, locationId, { operation: operation as "purchase" | "dispose" | "transfer" | "inventory_adjustment", enabled: formData.get("enabled") === "on", autonomous: formData.get("autonomous") === "on", thresholds: { minimumQuantity: Number(formData.get("minimumQuantity") ?? 0), supplierName: String(formData.get("supplierName") ?? "Automated replenishment") } }); revalidatePath(`/app/${organizationSlug}/forecast/settings`); return { ok: true, data: undefined, message: "Automation policy saved.", requestId: crypto.randomUUID() }; } catch { return { ok: false, code: "FORBIDDEN", message: "You do not have permission to change automation policies.", requestId: crypto.randomUUID() }; }
}

export async function saveCausalEventAction(organizationId: string, organizationSlug: string, locationId: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try { await saveCausalForecastEvent({ actorId: user.id, organizationId, locationId, name: String(formData.get("name") ?? ""), startsOn: String(formData.get("startsOn") ?? ""), endsOn: String(formData.get("endsOn") ?? ""), demandMultiplier: Number(formData.get("demandMultiplier") ?? 1), notes: String(formData.get("notes") ?? "") }); revalidatePath(`/app/${organizationSlug}/forecast/settings`); return { ok: true, data: undefined, message: "Causal event saved.", requestId: crypto.randomUUID() }; } catch { return { ok: false, code: "VALIDATION_ERROR", message: "The causal event could not be saved.", requestId: crypto.randomUUID() }; }
}

export async function saveComplianceProfileAction(organizationId: string, organizationSlug: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try { await saveComplianceProfile({ actorId: user.id, organizationId, countryCode: String(formData.get("countryCode") ?? "US").toUpperCase(), enabled: formData.get("enabled") === "on", rules: { quietHours: String(formData.get("quietHours") ?? "22:00-08:00"), consentRequired: true } }); revalidatePath(`/app/${organizationSlug}/settings/advanced`); return { ok: true, data: undefined, message: "Compliance profile saved.", requestId: crypto.randomUUID() }; } catch { return { ok: false, code: "FORBIDDEN", message: "You do not have permission to change compliance profiles.", requestId: crypto.randomUUID() }; }
}
