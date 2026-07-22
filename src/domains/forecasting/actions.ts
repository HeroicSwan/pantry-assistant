"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/access";
import { logServerError, mapProviderError } from "@/lib/errors";
import {
  acknowledgeOpenAlerts,
  processForecastJob,
  queueForecast,
  transitionAlert,
  updateLocationForecastConfiguration,
} from "@/domains/forecasting/service";

function failure(
  scope: string,
  requestId: string,
  error: unknown,
): ActionResult {
  const provider =
    error instanceof Error
      ? { message: error.message, code: (error as { code?: string }).code }
      : {};
  logServerError(scope, requestId, provider);
  return mapProviderError(provider, requestId);
}

export async function recalculateForecastAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  state: ActionResult,
): Promise<ActionResult> {
  void state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    const job = await queueForecast(
      actor.id,
      organizationId,
      locationId,
      requestId,
    );
    await processForecastJob(job.id);
    revalidatePath(`/app/${organizationSlug}/forecast`);
    revalidatePath(`/app/${organizationSlug}/alerts`);
    return {
      ok: true,
      data: undefined,
      message: "Forecast recalculated.",
      requestId,
    };
  } catch (error) {
    return failure("forecast.recalculate", requestId, error);
  }
}

export async function alertTransitionAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  alertId: string,
  target: "acknowledged" | "resolved" | "dismissed" | "open",
  state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    await transitionAlert(
      actor.id,
      organizationId,
      locationId,
      alertId,
      target,
      String(formData.get("reason") ?? ""),
      requestId,
    );
    revalidatePath(`/app/${organizationSlug}/alerts`);
    return {
      ok: true,
      data: undefined,
      message: `Alert ${target}.`,
      requestId,
    };
  } catch (error) {
    return failure("alert.transition", requestId, error);
  }
}

export async function acknowledgeOpenAlertsAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void state;
  void formData;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    const result = await acknowledgeOpenAlerts(
      actor.id,
      organizationId,
      locationId,
      requestId,
    );
    revalidatePath(`/app/${organizationSlug}/alerts`);
    return {
      ok: true,
      data: undefined,
      message: result.count
        ? `Acknowledged ${result.count} open alert${result.count === 1 ? "" : "s"}.`
        : "There are no open alerts to acknowledge.",
      requestId,
    };
  } catch (error) {
    return failure("alert.bulk_acknowledge", requestId, error);
  }
}

export async function updateForecastConfigurationAction(
  organizationId: string,
  organizationSlug: string,
  locationId: string,
  state: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void state;
  const requestId = crypto.randomUUID();
  const actor = await requireUser();
  try {
    await updateLocationForecastConfiguration(
      actor.id,
      organizationId,
      locationId,
      {
        weight7: Number(formData.get("weight7")),
        weight30: Number(formData.get("weight30")),
        weight90: Number(formData.get("weight90")),
        safetyStockDays: Number(formData.get("safetyStockDays")),
        leadTimeDays: Number(formData.get("leadTimeDays")),
        horizonDays: Number(formData.get("horizonDays")),
      },
      requestId,
    );
    revalidatePath(`/app/${organizationSlug}/forecast/settings`);
    return {
      ok: true,
      data: undefined,
      message:
        "Forecast configuration saved. Recalculate to create a new snapshot.",
      requestId,
    };
  } catch (error) {
    return failure("forecast.configure", requestId, error);
  }
}
