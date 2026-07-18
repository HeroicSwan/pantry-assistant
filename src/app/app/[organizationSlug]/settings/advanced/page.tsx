import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveAutomationPolicyAction, saveComplianceProfileAction } from "@/domains/advanced/actions";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function AdvancedSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "organization.view")) notFound();
  const location = context.activeLocation;
  if (!location) notFound();
  const canManageAutomation = can(context.effectivePermissions, "automation.manage");
  const canManageCompliance = can(context.effectivePermissions, "compliance.manage");
  return <div className="grid gap-10">
    <PageHeader eyebrow="Advanced controls" title={`${context.access.organization.name} · ${location.name}`} description="Advanced forecasting, autonomous operations, and country-specific compliance are opt-in and audited." />
    {canManageAutomation ? <section className="grid gap-4 border border-[var(--rule)] bg-white p-6"><h2 className="text-2xl font-semibold">Autonomous operations</h2><p className="text-sm text-[var(--muted)]">Disabled policies only create no actions. Autonomous mode creates auditable purchase orders or expired-stock removals from current forecasts.</p><ActionForm action={saveAutomationPolicyAction.bind(null, context.access.organization.id, organizationSlug, location.id)} className="grid gap-4 md:grid-cols-2"><SelectField label="Operation" name="operation" defaultValue="purchase"><option value="purchase">Purchase replenishment</option><option value="dispose">Dispose expired stock</option><option value="transfer">Transfer request</option><option value="inventory_adjustment">Inventory adjustment</option></SelectField><Field label="Minimum quantity" name="minimumQuantity" type="number" min="0" step="0.01" defaultValue="0" /><Field label="Supplier name" name="supplierName" defaultValue="Automated replenishment" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" /> Enable policy</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autonomous" /> Allow autonomous execution</label><div><SubmitButton>Save automation policy</SubmitButton></div></ActionForm></section> : null}
    {canManageCompliance ? <section className="grid gap-4 border border-[var(--rule)] bg-white p-6"><h2 className="text-2xl font-semibold">Country compliance profile</h2><ActionForm action={saveComplianceProfileAction.bind(null, context.access.organization.id, organizationSlug)} className="grid gap-4 md:grid-cols-2"><Field label="Country code" name="countryCode" defaultValue="US" maxLength={2} required /><Field label="Quiet hours" name="quietHours" defaultValue="22:00-08:00" required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked /> Enable profile</label><div><SubmitButton>Save compliance profile</SubmitButton></div></ActionForm></section> : null}
  </div>;
}
