import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { createDonorAction } from "@/domains/inventory/operations-actions";
import { listDonors } from "@/domains/inventory/operations-queries";

export default async function DonorsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "donor.view")) notFound();
  const organizationId = context.access.organization.id;
  const rows = await listDonors(organizationId);
  return <div className="grid gap-10">
    <PageHeader eyebrow="Inventory operations" title="Donors" description="Organization-scoped donor records support donation history without exposing data across organizations." />
    <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="overflow-x-auto border border-[var(--rule)] bg-white">
        <table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b bg-[var(--surface)] text-left"><th className="p-3">Donor</th><th className="p-3">Type</th><th className="p-3">Donations</th><th className="p-3">Last donation</th><th className="p-3">Status</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-3"><Link className="font-semibold underline" href={`/app/${organizationSlug}/inventory/donors/${row.id}`}>{row.name}</Link></td><td className="p-3">{row.type.replaceAll("_", " ")}</td><td className="p-3 tabular">{row.donation_count}</td><td className="p-3">{row.last_donation_date ?? "—"}</td><td className="p-3">{row.status}</td></tr>)}</tbody>
        </table>
      </div>
      {can(context.effectivePermissions, "donor.create") ? <article className="border border-[var(--rule)] bg-white p-6"><h2 className="text-xl font-semibold">New donor</h2>
        <ActionForm action={createDonorAction.bind(null, organizationId, organizationSlug)} className="mt-4 grid gap-4">
          <SelectField label="Type" name="donorType" defaultValue="individual"><option value="individual">Individual</option><option value="business">Business</option><option value="nonprofit">Nonprofit</option><option value="food_bank">Food bank</option><option value="grocery_store">Grocery store</option><option value="farm">Farm</option><option value="other">Other</option></SelectField>
          <Field label="Name" name="name" required maxLength={120} /><Field label="Contact name" name="contactName" maxLength={120} /><Field label="Email" name="email" type="email" /><Field label="Phone" name="phoneNumber" maxLength={40} /><TextAreaField label="Notes" name="notes" maxLength={1000} /><SubmitButton>Create donor</SubmitButton>
        </ActionForm></article> : null}
    </section>
  </div>;
}
