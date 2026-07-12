"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { initialActionResult } from "@/lib/action-result";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type AuthFormProps = {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  mode: "sign-in" | "sign-up" | "forgot" | "reset";
  nextPath?: string;
  resetToken?: string;
};

export function AuthForm({ action, mode, nextPath, resetToken }: AuthFormProps) {
  const [state, formAction] = useActionState(action, initialActionResult);
  return (
    <form action={formAction} className="grid gap-5">
      {mode === "sign-up" ? (
        <Field
          label="Display name"
          name="displayName"
          autoComplete="name"
          required
          error={!state.ok ? state.fieldErrors?.displayName?.[0] : undefined}
        />
      ) : null}
      {mode !== "reset" ? (
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={!state.ok ? state.fieldErrors?.email?.[0] : undefined}
        />
      ) : null}
      {mode === "sign-in" || mode === "sign-up" || mode === "reset" ? (
        <Field
          label={mode === "reset" ? "New password" : "Password"}
          name="password"
          type="password"
          autoComplete={
            mode === "sign-in" ? "current-password" : "new-password"
          }
          required
          error={!state.ok ? state.fieldErrors?.password?.[0] : undefined}
        />
      ) : null}
      {mode === "sign-up" || mode === "reset" ? (
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={
            !state.ok ? state.fieldErrors?.confirmPassword?.[0] : undefined
          }
        />
      ) : null}
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
      {mode === "reset" ? <input type="hidden" name="token" value={resetToken ?? ""} /> : null}
      {state.requestId !== "initial" ? (
        <p
          aria-live="polite"
          className={
            state.ok
              ? "border-l-4 border-[var(--success)] pl-3 text-sm text-[var(--success)]"
              : "border-l-4 border-[var(--signal)] pl-3 text-sm text-[var(--signal)]"
          }
        >
          {state.message}
        </p>
      ) : null}
      <SubmitButton
        pendingLabel={mode === "forgot" ? "Requesting…" : "Submitting…"}
      >
        {mode === "sign-in"
          ? "Sign in"
          : mode === "sign-up"
            ? "Create account"
            : mode === "forgot"
              ? "Request password reset"
              : "Set new password"}
      </SubmitButton>
    </form>
  );
}
