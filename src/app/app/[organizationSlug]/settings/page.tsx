import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateOrganizationAction } from "@/domains/admin/actions";
import { getOrganizationSettingsForUser } from "@/domains/admin/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "organization.update")) notFound();
  const organization = await getOrganizationSettingsForUser(context.user.id, context.access.organization.id);
  if (!organization) notFound();
  const action = updateOrganizationAction.bind(
    null,
    organization.id,
    organizationSlug,
  );
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Organization"
        title="Organization settings"
        description="Update operational contact and locale information. The organization slug is immutable in version one so existing routes remain stable."
      />
      <ActionForm
        action={action}
        className="grid max-w-4xl gap-6 border border-[var(--rule)] bg-white p-6 sm:p-8"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Organization name"
            name="name"
            defaultValue={organization.name}
            required
          />
          <Field
            label="Organization slug"
            value={organization.slug}
            disabled
            hint="Slugs cannot be changed after onboarding."
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Timezone"
            name="timezone"
            defaultValue={organization.timezone}
          >
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
          </SelectField>
          <SelectField
            label="Default locale"
            name="defaultLocale"
            defaultValue={organization.default_locale}
          >
            <option value="en-US">English (United States)</option>
            <option value="es-US">Spanish (United States)</option>
          </SelectField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Contact email"
            name="email"
            type="email"
            defaultValue={organization.email ?? ""}
          />
          <Field
            label="Contact phone"
            name="phoneNumber"
            defaultValue={organization.phone_number ?? ""}
          />
        </div>
        <Field
          label="Address"
          name="addressLine1"
          defaultValue={organization.address_line_1 ?? ""}
        />
        <input
          type="hidden"
          name="addressLine2"
          value={organization.address_line_2 ?? ""}
        />
        <div className="grid gap-5 sm:grid-cols-4">
          <Field
            label="City"
            name="city"
            defaultValue={organization.city ?? ""}
          />
          <Field
            label="State or region"
            name="stateRegion"
            defaultValue={organization.state_region ?? ""}
          />
          <Field
            label="Postal code"
            name="postalCode"
            defaultValue={organization.postal_code ?? ""}
          />
          <Field
            label="Country code"
            name="countryCode"
            defaultValue={organization.country_code}
          />
        </div>
        <SubmitButton>Save organization settings</SubmitButton>
      </ActionForm>
    </div>
  );
}
