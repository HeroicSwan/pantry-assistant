import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";

type LocationValues = {
  name?: string;
  slug?: string;
  status?: string;
  timezone?: string | null;
  email?: string | null;
  phone_number?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state_region?: string | null;
  postal_code?: string | null;
  country_code?: string;
  operating_notes?: string | null;
};

export function LocationForm({
  action,
  values = {},
  includeSlug = false,
  submitLabel,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  values?: LocationValues;
  includeSlug?: boolean;
  submitLabel: string;
}) {
  return (
    <ActionForm
      action={action}
      className="grid max-w-4xl gap-6 border border-[var(--rule)] bg-white p-6 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Location name"
          name="name"
          defaultValue={values.name ?? ""}
          required
        />
        {includeSlug ? (
          <Field
            label="Location slug"
            name="slug"
            defaultValue={values.slug ?? ""}
            hint="Lowercase letters, numbers, and hyphens."
            required
          />
        ) : (
          <Field
            label="Location slug"
            value={values.slug ?? ""}
            disabled
            hint="Slugs are immutable."
          />
        )}
      </div>
      {!includeSlug ? (
        <SelectField
          label="Status"
          name="status"
          defaultValue={values.status ?? "active"}
        >
          <option value="active">Active</option>
          <option value="temporarily_closed">Temporarily closed</option>
        </SelectField>
      ) : (
        <input type="hidden" name="status" value="active" />
      )}
      <SelectField
        label="Timezone"
        name="timezone"
        defaultValue={values.timezone ?? "America/New_York"}
      >
        <option value="America/New_York">America/New_York</option>
        <option value="America/Chicago">America/Chicago</option>
        <option value="America/Denver">America/Denver</option>
        <option value="America/Los_Angeles">America/Los_Angeles</option>
      </SelectField>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Contact email"
          name="email"
          type="email"
          defaultValue={values.email ?? ""}
        />
        <Field
          label="Phone number"
          name="phoneNumber"
          defaultValue={values.phone_number ?? ""}
        />
      </div>
      <Field
        label="Address"
        name="addressLine1"
        defaultValue={values.address_line_1 ?? ""}
      />
      <input
        type="hidden"
        name="addressLine2"
        value={values.address_line_2 ?? ""}
      />
      <div className="grid gap-5 sm:grid-cols-4">
        <Field label="City" name="city" defaultValue={values.city ?? ""} />
        <Field
          label="State or region"
          name="stateRegion"
          defaultValue={values.state_region ?? ""}
        />
        <Field
          label="Postal code"
          name="postalCode"
          defaultValue={values.postal_code ?? ""}
        />
        <Field
          label="Country code"
          name="countryCode"
          defaultValue={values.country_code ?? "US"}
        />
      </div>
      <TextAreaField
        label="Operating notes"
        name="operatingNotes"
        defaultValue={values.operating_notes ?? ""}
        hint="Do not include household information."
      />
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
