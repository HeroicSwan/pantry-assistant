"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth/server";
import { getServerEnvironment } from "@/lib/env";
import { logServerError, mapProviderError } from "@/lib/errors";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "@/domains/auth/schemas";

function authFailure(error: unknown, requestId: string) {
  const providerError = error instanceof Error ? { message: error.message } : {};
  logServerError("auth", requestId, providerError);
  return mapProviderError(providerError, requestId);
}

export async function signInAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors, requestId };
  try {
    await auth.api.signInEmail({ body: { email: parsed.data.email, password: parsed.data.password, rememberMe: true }, headers: await headers() });
  } catch {
    return { ok: false, code: "UNAUTHENTICATED", message: "The email or password is incorrect.", requestId };
  }
  redirect(safeNextPath(parsed.data.next, "/"));
}

export async function signUpAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors, requestId };
  try {
    await auth.api.signUpEmail({ body: { name: parsed.data.displayName, email: parsed.data.email, password: parsed.data.password }, headers: await headers() });
  } catch (error) {
    return authFailure(error, requestId);
  }
  redirect("/onboarding");
}

export async function forgotPasswordAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Enter a valid email address.", fieldErrors: parsed.error.flatten().fieldErrors, requestId };
  try {
    await auth.api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: `${getServerEnvironment().APP_URL}/reset-password` } });
  } catch (error) {
    logServerError("auth.password_recovery", requestId, error instanceof Error ? { message: error.message } : {});
  }
  return { ok: true, data: undefined, message: "If an account matches that address, password reset instructions are on the way.", requestId };
}

export async function resetPasswordAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: "Review the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors, requestId };
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token } });
  } catch (error) {
    return authFailure(error, requestId);
  }
  redirect("/sign-in");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
