"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { onboardOrganizationAction } from "@/domains/onboarding/actions";
import {
  onboardingSchema,
  type OnboardingInput,
} from "@/domains/onboarding/schemas";
import { normalizeSlug } from "@/lib/validation";

const steps = ["Profile", "Organization", "Location", "Review"] as const;
const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function OnboardingForm({
  initialDisplayName,
  initialEmail,
}: {
  initialDisplayName: string;
  initialEmail: string;
}) {
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    mode: "onBlur",
    defaultValues: {
      idempotencyKey,
      profile: {
        displayName: initialDisplayName,
        firstName: "",
        lastName: "",
        preferredLocale: "en-US",
      },
      organization: {
        name: "",
        slug: "",
        timezone: "America/New_York",
        defaultLocale: "en-US",
        email: initialEmail,
        phoneNumber: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        countryCode: "US",
      },
      location: {
        name: "",
        slug: "",
        timezone: "America/New_York",
        email: "",
        phoneNumber: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        countryCode: "US",
        operatingNotes: "",
      },
    },
  });
  const values = useWatch({ control: form.control }) as OnboardingInput;
  const errors = form.formState.errors;

  const fieldsByStep: Array<
    Array<
      | keyof OnboardingInput
      | `profile.${string}`
      | `organization.${string}`
      | `location.${string}`
    >
  > = [
    [
      "profile.displayName",
      "profile.firstName",
      "profile.lastName",
      "profile.preferredLocale",
    ],
    [
      "organization.name",
      "organization.slug",
      "organization.timezone",
      "organization.defaultLocale",
      "organization.email",
      "organization.countryCode",
    ],
    [
      "location.name",
      "location.slug",
      "location.timezone",
      "location.countryCode",
    ],
    [],
  ];

  async function nextStep() {
    const valid = await form.trigger(fieldsByStep[step] as never);
    if (valid) setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function submit(input: OnboardingInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await onboardOrganizationAction(input);
      if (!result.ok)
        setServerError(`${result.message} Request ${result.requestId}`);
    });
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="grid gap-8">
      <ol
        aria-label="Onboarding progress"
        className="grid grid-cols-2 border-t border-l border-[var(--rule)] sm:grid-cols-4"
      >
        {steps.map((label, index) => (
          <li
            key={label}
            className={`border-r border-b border-[var(--rule)] p-3 ${index === step ? "bg-[var(--ink)] text-white" : "bg-white"}`}
            aria-current={index === step ? "step" : undefined}
          >
            <span className="tabular mr-2 text-[var(--signal)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-sm font-semibold">{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="grid gap-5" aria-labelledby="profile-step">
          <h2
            id="profile-step"
            className="text-2xl font-semibold tracking-[-0.03em]"
          >
            Your profile
          </h2>
          <Field
            label="Display name"
            {...form.register("profile.displayName")}
            error={errors.profile?.displayName?.message}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="First name"
              {...form.register("profile.firstName")}
              error={errors.profile?.firstName?.message}
            />
            <Field
              label="Last name"
              {...form.register("profile.lastName")}
              error={errors.profile?.lastName?.message}
            />
          </div>
          <SelectField
            label="Preferred locale"
            {...form.register("profile.preferredLocale")}
          >
            <option value="en-US">English (United States)</option>
            <option value="es-US">Spanish (United States)</option>
          </SelectField>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="grid gap-5" aria-labelledby="organization-step">
          <h2
            id="organization-step"
            className="text-2xl font-semibold tracking-[-0.03em]"
          >
            Organization
          </h2>
          <Field
            label="Organization name"
            {...form.register("organization.name", {
              onChange: (event) => {
                if (!form.formState.dirtyFields.organization?.slug)
                  form.setValue(
                    "organization.slug",
                    normalizeSlug(event.target.value),
                  );
              },
            })}
            error={errors.organization?.name?.message}
          />
          <Field
            label="Organization slug"
            hint="This stable slug appears in organization URLs and cannot be edited later."
            {...form.register("organization.slug")}
            error={errors.organization?.slug?.message}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Timezone"
              {...form.register("organization.timezone")}
              error={errors.organization?.timezone?.message}
            >
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Default locale"
              {...form.register("organization.defaultLocale")}
            >
              <option value="en-US">English (United States)</option>
              <option value="es-US">Spanish (United States)</option>
            </SelectField>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Contact email"
              type="email"
              {...form.register("organization.email")}
              error={errors.organization?.email?.message}
            />
            <Field
              label="Contact phone"
              {...form.register("organization.phoneNumber")}
            />
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="grid gap-5" aria-labelledby="location-step">
          <h2
            id="location-step"
            className="text-2xl font-semibold tracking-[-0.03em]"
          >
            Initial pantry location
          </h2>
          <Field
            label="Location name"
            {...form.register("location.name", {
              onChange: (event) => {
                if (!form.formState.dirtyFields.location?.slug)
                  form.setValue(
                    "location.slug",
                    normalizeSlug(event.target.value),
                  );
              },
            })}
            error={errors.location?.name?.message}
          />
          <Field
            label="Location slug"
            {...form.register("location.slug")}
            error={errors.location?.slug?.message}
          />
          <SelectField
            label="Timezone"
            {...form.register("location.timezone")}
            error={errors.location?.timezone?.message}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </SelectField>
          <Field label="Address" {...form.register("location.addressLine1")} />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City" {...form.register("location.city")} />
            <Field
              label="State or region"
              {...form.register("location.stateRegion")}
            />
            <Field
              label="Postal code"
              {...form.register("location.postalCode")}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Phone number"
              {...form.register("location.phoneNumber")}
            />
            <Field
              label="Country code"
              {...form.register("location.countryCode")}
              error={errors.location?.countryCode?.message}
            />
          </div>
          <TextAreaField
            label="Operating notes"
            hint="Optional setup information. Do not enter household information."
            {...form.register("location.operatingNotes")}
          />
        </section>
      ) : null}

      {step === 3 ? (
        <section className="grid gap-6" aria-labelledby="review-step">
          <h2
            id="review-step"
            className="text-2xl font-semibold tracking-[-0.03em]"
          >
            Review
          </h2>
          <dl className="grid border-t border-[var(--ink)]">
            {[
              ["Profile", values.profile.displayName],
              ["Organization", values.organization.name],
              ["Organization URL", `/app/${values.organization.slug}`],
              ["Initial location", values.location.name],
              [
                "Timezone",
                values.location.timezone || values.organization.timezone,
              ],
              [
                "Access",
                "Active organization membership and administrator role",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid gap-1 border-b border-[var(--rule)] py-4 sm:grid-cols-[180px_1fr]"
              >
                <dt className="text-sm font-semibold">{label}</dt>
                <dd className="m-0 text-sm text-[var(--muted)]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm leading-6 text-[var(--muted)]">
            Submission creates the organization, initial location, membership,
            administrator assignment, preferences, and audit records in one
            database transaction.
          </p>
        </section>
      ) : null}

      {serverError ? (
        <p
          role="alert"
          className="border-l-4 border-[var(--signal)] pl-3 text-sm text-[var(--signal)]"
        >
          {serverError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--rule)] pt-6">
        <Button
          type="button"
          variant="quiet"
          disabled={step === 0 || isPending}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          Back
        </Button>
        {step < steps.length - 1 ? (
          <Button type="button" onClick={nextStep}>
            Continue
          </Button>
        ) : (
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating organization…" : "Create organization"}
          </Button>
        )}
      </div>
    </form>
  );
}
