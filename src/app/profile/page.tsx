import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateOwnProfileAction } from "@/domains/admin/actions";
import { getCurrentProfile, requireUser } from "@/lib/auth/access";

export default async function ProfilePage() {
  await requireUser();
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-10 px-6 py-10 sm:px-10 lg:px-16">
      <div>
        <Link className="text-sm font-semibold underline" href="/">
          Return to workspace
        </Link>
      </div>
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="Safe self-service profile fields. Email and authorization fields remain controlled by Better Auth and trusted administrative operations."
      />
      <ActionForm
        action={updateOwnProfileAction}
        className="grid gap-6 border border-[var(--rule)] bg-white p-6 sm:p-8"
      >
        <Field
          label="Account email"
          value={profile.email}
          disabled
          hint="Change email through the authentication provider."
        />
        <Field
          label="Display name"
          name="displayName"
          defaultValue={profile.displayName}
          required
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="First name"
            name="firstName"
            defaultValue={profile.firstName ?? ""}
          />
          <Field
            label="Last name"
            name="lastName"
            defaultValue={profile.lastName ?? ""}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Phone number"
            name="phoneNumber"
            defaultValue={profile.phoneNumber ?? ""}
          />
          <SelectField
            label="Preferred locale"
            name="preferredLocale"
            defaultValue={profile.preferredLocale}
          >
            <option value="en-US">English (United States)</option>
            <option value="es-US">Spanish (United States)</option>
          </SelectField>
        </div>
        <SubmitButton>Save profile</SubmitButton>
      </ActionForm>
    </main>
  );
}
