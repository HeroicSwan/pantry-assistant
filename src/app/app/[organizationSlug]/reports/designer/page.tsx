import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveReportDefinitionAction } from "@/domains/reports/designer-actions";
import { listReportDefinitions } from "@/domains/reports/designer";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function ReportDesignerPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "report.view")) notFound();
  const definitions = await listReportDefinitions(context.user.id, context.access.organization.id);
  const mayDesign = can(context.effectivePermissions, "report.design");
  return <div className="grid gap-10">
    <PageHeader eyebrow="Reports" title="Report designer" description="Save reusable report layouts from approved operational data sources. Data access remains permission-scoped." />
    {mayDesign ? <ActionForm action={saveReportDefinitionAction.bind(null, context.access.organization.id, organizationSlug)} className="grid gap-4 border border-[var(--rule)] bg-white p-6 md:grid-cols-2">
      <Field label="Report name" name="name" required />
      <Field label="Slug" name="slug" placeholder="weekly-food-distribution" required />
      <Field label="Description" name="description" />
      <SelectField label="Data source" name="source" defaultValue="inventory-on-hand"><option value="inventory-on-hand">Inventory on hand</option><option value="forecasts">Forecasts</option><option value="distributions">Distributions</option><option value="messaging">Messaging</option><option value="weekly-summary">Weekly summary</option></SelectField>
      <Field label="Columns" name="columns" placeholder="item, available_quantity, unit" required />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" /> Share with organization</label>
      <div><SubmitButton>Save report layout</SubmitButton></div>
    </ActionForm> : null}
    <section className="grid gap-3"><h2 className="text-2xl font-semibold">Saved layouts</h2>{definitions.length ? definitions.map((definition) => <article key={String(definition.id)} className="border border-[var(--rule)] bg-white p-5"><h3 className="font-semibold">{String(definition.name)}</h3><p className="mt-1 text-sm text-[var(--muted)]">{String(definition.description ?? "")} · {String(definition.slug)}</p><pre className="mt-3 overflow-auto bg-[var(--surface)] p-3 text-xs">{JSON.stringify(definition.definition, null, 2)}</pre></article>) : <p className="text-sm text-[var(--muted)]">No custom report layouts yet.</p>}</section>
  </div>;
}
