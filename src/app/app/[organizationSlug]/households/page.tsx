import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { createHouseholdAction } from "@/domains/pickups/actions";
import { listHouseholds } from "@/domains/pickups/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function HouseholdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { organizationSlug } = await params;
  const { q } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "household.view_basic")) notFound();
  const organizationId = context.access.organization.id;
  const mayCreate = can(context.effectivePermissions, "household.create");
  const households = await listHouseholds(organizationId, q);

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Households"
        title="Household directory"
        description="Operational household records stay organization-scoped. Sensitive notes and contacts require separate permissions."
      />
      {mayCreate ? (
        <section className="max-w-3xl border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Create household</h2>
          <ActionForm action={createHouseholdAction.bind(null, organizationId, organizationSlug)} className="mt-5 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Household name" name="displayName" required />
              <Field label="Household size" name="householdSize" type="number" min="1" max="50" required />
              <Field label="Adults" name="adultCount" type="number" min="0" />
              <Field label="Children" name="childCount" type="number" min="0" />
              <Field label="Seniors" name="seniorCount" type="number" min="0" />
              <SelectField label="Preferred language" name="preferredLanguage" defaultValue="en">
                <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option>
              </SelectField>
            </div>
            <TextAreaField label="Operational notes (optional)" name="operationalNotes" maxLength={500} />
            <Field label="External reference (optional)" name="externalReference" maxLength={80} />
            <SubmitButton pendingLabel="Creating…">Create household</SubmitButton>
          </ActionForm>
        </section>
      ) : null}
      <section className="grid gap-4">
        <form className="flex max-w-lg gap-2" action={`/app/${organizationSlug}/households`}>
          <input className="min-h-11 flex-1 border border-[var(--rule)] bg-white px-3" name="q" defaultValue={q} placeholder="Search name or household number" />
          <button className="min-h-11 border border-[var(--ink)] px-4 text-sm font-semibold" type="submit">Search</button>
        </form>
        {households.length === 0 ? <EmptyState title="No households found" description="Create a household or change the search term." /> : (
          <div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full min-w-[740px] text-sm"><thead><tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left"><th className="p-3">Household</th><th className="p-3">Size</th><th className="p-3">Next appointment</th><th className="p-3">Duplicate alert</th><th className="p-3">Status</th></tr></thead><tbody>{households.map((household) => <tr key={household.id} className="border-b border-[var(--rule)] last:border-0"><td className="p-3"><Link className="font-semibold underline" href={`/app/${organizationSlug}/households/${household.id}`}>{household.display_name}</Link><p className="text-xs text-[var(--muted)]">{household.household_number}</p></td><td className="p-3">{household.household_size}</td><td className="p-3">{household.next_appointment_at ? new Date(household.next_appointment_at).toLocaleString() : "—"}</td><td className="p-3">{household.duplicate_phone ? "Review shared phone" : "—"}</td><td className="p-3"><StatusBadge status={household.status} /></td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
