import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { startCycleCountAction } from "@/domains/inventory/operations-actions";
import { listCycleCounts } from "@/domains/inventory/operations-queries";

export default async function CountsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params; const context = await requireOrganizationContext(organizationSlug); if (!can(context.effectivePermissions, "inventory.view")) notFound(); const location = context.activeLocation;
  if (!location) return <PageHeader eyebrow="Inventory controls" title="Cycle counts" description="Select a pantry location." />; const organizationId = context.access.organization.id; const counts = await listCycleCounts(organizationId, location.id);
  return <div className="grid gap-10"><PageHeader eyebrow="Inventory controls" title="Cycle counts" description="Each session captures a ledger snapshot. Reconciliation refuses stale counts if stock changes before approval." />
    {can(context.effectivePermissions, "inventory.reconcile") ? <ActionForm action={startCycleCountAction.bind(null, organizationId, organizationSlug, location.id)} className="grid gap-4 border bg-white p-6"><TextAreaField label="Count notes" name="notes" placeholder="Full room count, freezer only, monthly count…" /><SubmitButton>Start cycle count</SubmitButton></ActionForm> : null}
    <section className="grid gap-3">{counts.map((count) => <Link key={count.id} href={`/app/${organizationSlug}/inventory/counts/${count.id}`} className="grid gap-2 border bg-white p-5 sm:grid-cols-[1fr_auto]"><div><strong>Count {count.id.slice(0, 8)}</strong><p className="text-sm text-[var(--muted)]">Snapshot {new Date(count.snapshot_at).toLocaleString()} · {count.notes ?? "No notes"}</p></div><span className="text-sm font-semibold">{count.status} · {count.counted_count}/{count.entry_count}</span></Link>)}</section>
  </div>;
}
