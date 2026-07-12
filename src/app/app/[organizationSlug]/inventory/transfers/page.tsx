import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { createTransferAction } from "@/domains/inventory/operations-actions";
import { listOperationalChoices, listTransfers } from "@/domains/inventory/operations-queries";

export default async function TransfersPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params; const context = await requireOrganizationContext(organizationSlug); if (!can(context.effectivePermissions, "inventory.view")) notFound(); const location = context.activeLocation;
  if (!location) return <PageHeader eyebrow="Inventory operations" title="Transfers" description="Select a pantry location." />; const organizationId = context.access.organization.id; const [transfers, choices] = await Promise.all([listTransfers(organizationId, location.id), listOperationalChoices(organizationId, location.id)]);
  return <div className="grid gap-10"><PageHeader eyebrow="Inventory operations" title="Transfers" description="Dispatch posts stock out of the source. Partial receipts post stock into destination lots and leave the remainder in transit." />
    {can(context.effectivePermissions, "inventory.transfer") ? <section className="border bg-white p-6"><h2 className="text-xl font-semibold">New transfer draft</h2><ActionForm action={createTransferAction.bind(null, organizationId, organizationSlug, location.id)} className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Transfer number" name="transferNumber" required placeholder={`TR-${new Date().getFullYear()}-`} /><SelectField label="Destination" name="destinationLocationId" required><option value="">Select location</option>{choices.locations.filter((l) => l.id !== location.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectField><SelectField label="Source lot" name="lotId" required><option value="">Select lot</option>{choices.lots.filter((l) => Number(l.available_quantity) > 0).map((l) => <option key={l.id} value={l.id}>{l.item_name} · {l.lot_code ?? "unlabeled"} · {l.available_quantity} {l.base_unit}</option>)}</SelectField><Field label="Quantity" name="quantity" required /><SelectField label="Unit" name="unitId" required><option value="">Select unit</option>{choices.items.map((i) => <option key={i.id} value={i.base_unit_id}>{i.name} · {i.base_unit}</option>)}</SelectField><TextAreaField label="Notes" name="notes" /><SubmitButton>Create transfer</SubmitButton></ActionForm></section> : null}
    <section className="grid gap-3">{transfers.map((row) => <Link key={row.id} href={`/app/${organizationSlug}/inventory/transfers/${row.id}`} className="grid gap-2 border bg-white p-5 md:grid-cols-[1fr_auto]"><div><strong>{row.transfer_number}</strong><p className="text-sm text-[var(--muted)]">{row.source_name} → {row.destination_name} · {row.line_count} lines</p></div><span className="text-sm font-semibold">{row.status.replaceAll("_", " ")} · {row.in_transit_quantity} in transit</span></Link>)}</section>
  </div>;
}
