import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { archiveDonorAction, updateDonorAction } from "@/domains/inventory/operations-actions";
import { getDonor } from "@/domains/inventory/operations-queries";

export default async function DonorDetailPage({ params }: { params: Promise<{ organizationSlug: string; donorId: string }> }) {
  const { organizationSlug, donorId } = await params; const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "donor.view")) notFound();
  const organizationId = context.access.organization.id; const result = await getDonor(organizationId, donorId); if (!result) notFound();
  const donor = result.donor as Record<string, unknown>;
  return <div className="grid gap-10"><PageHeader eyebrow="Donor record" title={String(donor.name)} description={`${String(donor.donor_type).replaceAll("_", " ")} · ${String(donor.status)}`} />
    <section className="grid gap-6 lg:grid-cols-2"><article className="border bg-white p-6"><h2 className="text-xl font-semibold">Donation history</h2><ul className="mt-4 grid gap-3">{result.history.map((entry) => <li key={String(entry.id)} className="border-b pb-3"><strong>{String(entry.donation_number)}</strong><span className="ml-2 text-[var(--muted)]">{String(entry.donation_date)} · {String(entry.status)}</span></li>)}</ul></article>
      {can(context.effectivePermissions, "donor.update") && donor.status === "active" ? <article className="border bg-white p-6"><h2 className="text-xl font-semibold">Contact details</h2><ActionForm action={updateDonorAction.bind(null, organizationId, organizationSlug, donorId)} className="mt-4 grid gap-4"><Field label="Name" name="name" required defaultValue={String(donor.name ?? "")} /><Field label="Contact name" name="contactName" defaultValue={String(donor.contact_name ?? "")} /><Field label="Email" name="email" type="email" defaultValue={String(donor.email ?? "")} /><Field label="Phone" name="phoneNumber" defaultValue={String(donor.phone_number ?? "")} /><TextAreaField label="Notes" name="notes" defaultValue={String(donor.notes ?? "")} /><SubmitButton>Save donor</SubmitButton></ActionForm></article> : null}
    </section>
    {can(context.effectivePermissions, "donor.archive") && donor.status === "active" && donor.is_anonymous_placeholder !== true ? <section className="border border-[var(--signal)] bg-white p-6"><h2 className="text-xl font-semibold">Archive donor</h2><ActionForm action={archiveDonorAction.bind(null, organizationId, organizationSlug, donorId)} className="mt-4 flex flex-wrap items-end gap-3"><Field label="Reason" name="reason" required className="min-w-72" /><SubmitButton>Archive donor</SubmitButton></ActionForm></section> : null}
  </div>;
}
