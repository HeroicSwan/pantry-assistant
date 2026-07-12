"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { getOrganizationAccessList, requireUser } from "@/lib/auth/access";
import { logServerError, mapProviderError } from "@/lib/errors";
import { onboardingSchema, type OnboardingInput } from "@/domains/onboarding/schemas";
import { onboardOrganization } from "@/domains/onboarding/service";

type OnboardingResult = { organizationSlug: string };

export async function onboardOrganizationAction(input: OnboardingInput): Promise<ActionResult<OnboardingResult>> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  if ((await getOrganizationAccessList()).length > 0) return { ok: false, code: "FORBIDDEN", message: "Onboarding is already complete for this account.", requestId };
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the onboarding information and try again.", fieldErrors: parsed.error.flatten().fieldErrors, requestId };
  let result: Awaited<ReturnType<typeof onboardOrganization>>;
  try {
    result = await onboardOrganization(currentUser.id, parsed.data, requestId);
  } catch (error) {
    logServerError("organization.onboard", requestId, error instanceof Error ? { message: error.message } : {});
    return mapProviderError(error instanceof Error ? { message: error.message } : {}, requestId) as ActionResult<OnboardingResult>;
  }
  redirect(`/app/${result.organizationSlug}/dashboard`);
}
