"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Field, SelectField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type InvitationResult = { acceptanceUrl: string };

const initial: ActionResult<InvitationResult | undefined> = {
  ok: true,
  data: undefined,
  requestId: "initial",
};

export function InvitationForm({
  action,
  roles,
  locations,
}: {
  action: (
    state: ActionResult<InvitationResult | undefined>,
    formData: FormData,
  ) => Promise<ActionResult<InvitationResult>>;
  roles: Array<{ id: string; name: string; scope: string }>;
  locations: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form
      action={formAction}
      className="grid gap-4 border border-[var(--rule)] bg-white p-5"
    >
      <h2 className="text-xl font-semibold">Prepare invitation</h2>
      <Field label="Email address" name="email" type="email" required />
      <SelectField label="Role" name="roleId" required>
        <option value="">Select a role</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name} · {role.scope}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Location"
        name="locationId"
        hint="Required for location-scoped roles."
      >
        <option value="">Organization-wide</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </SelectField>
      <SubmitButton pendingLabel="Preparing…">Prepare invitation</SubmitButton>
      {state.requestId !== "initial" ? (
        <div
          aria-live="polite"
          className={
            state.ok
              ? "border-l-4 border-[var(--success)] pl-3 text-sm"
              : "border-l-4 border-[var(--signal)] pl-3 text-sm text-[var(--signal)]"
          }
        >
          <p>{state.message}</p>
          {state.ok && state.data ? (
            <label className="mt-3 grid gap-2 font-semibold">
              Secure acceptance link
              <input
                readOnly
                value={state.data.acceptanceUrl}
                className="w-full border border-[var(--rule)] bg-[var(--surface)] px-3 py-2 font-normal"
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
