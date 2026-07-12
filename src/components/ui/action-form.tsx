"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { initialActionResult } from "@/lib/action-result";

export function ActionForm({
  action,
  children,
  className = "grid gap-5",
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionResult);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.requestId !== "initial" ? (
        <p
          aria-live="polite"
          className={
            state.ok
              ? "border-l-4 border-[var(--success)] pl-3 text-sm text-[var(--success)]"
              : "border-l-4 border-[var(--signal)] pl-3 text-sm text-[var(--signal)]"
          }
        >
          {state.message}{" "}
          <span className="tabular text-xs">{state.requestId}</span>
        </p>
      ) : null}
    </form>
  );
}
