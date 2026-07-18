import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveAdvancedForecastAction, saveCausalEventAction } from "@/domains/advanced/actions";
import { updateForecastConfigurationAction } from "@/domains/forecasting/actions";
import { forecastConfiguration } from "@/domains/forecasting/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function ForecastSettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "forecast.configure")) notFound();
  if (!context.activeLocation) notFound();
  const rows = await forecastConfiguration(context.access.organization.id, context.activeLocation.id);
  const current = rows[0] ?? {};
  return <div className="grid gap-10">
    <PageHeader eyebrow="Forecast configuration" title={context.activeLocation.name} description="Deterministic settings remain available alongside the opt-in seasonal and causal model." actions={<Link className="inline-flex min-h-11 items-center border border-[var(--ink)] px-4 text-sm font-semibold" href={`/app/${organizationSlug}/settings/advanced`}>Advanced controls</Link>} />
    <section className="max-w-2xl border border-[var(--rule)] bg-white p-6"><ActionForm action={updateForecastConfigurationAction.bind(null, context.access.organization.id, organizationSlug, context.activeLocation.id)} className="grid gap-4"><div className="grid gap-4 sm:grid-cols-3"><Field label="7-day weight" name="weight7" type="number" min="0" step="0.01" defaultValue={String(current.lookback_7_day_weight ?? 0.5)} required /><Field label="30-day weight" name="weight30" type="number" min="0" step="0.01" defaultValue={String(current.lookback_30_day_weight ?? 0.3)} required /><Field label="90-day weight" name="weight90" type="number" min="0" step="0.01" defaultValue={String(current.lookback_90_day_weight ?? 0.2)} required /></div><Field label="Safety-stock days" name="safetyStockDays" type="number" min="0" step="0.25" defaultValue={String(current.safety_stock_days ?? 2)} required /><Field label="Lead-time days" name="leadTimeDays" type="number" min="0" step="1" defaultValue={String(current.lead_time_days ?? 3)} required /><Field label="Forecast horizon days" name="horizonDays" type="number" min="1" max="365" step="1" defaultValue={String(current.forecast_horizon_days ?? 30)} required /><SubmitButton pendingLabel="Saving...">Save configuration</SubmitButton></ActionForm></section>
    <section className="max-w-2xl border border-[var(--rule)] bg-white p-6"><h2 className="text-2xl font-semibold">Hybrid seasonal and causal model</h2><p className="mt-2 text-sm text-[var(--muted)]">Learns weekday/month patterns and trend from local pickup history. Causal event multipliers are stored separately and are applied to future snapshots.</p><ActionForm action={saveAdvancedForecastAction.bind(null, context.access.organization.id, organizationSlug, context.activeLocation.id)} className="mt-4 grid gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" /> Enable advanced model</label><Field label="Weekday factors (optional JSON)" name="weekdayFactors" placeholder="{&quot;0&quot;:1,&quot;1&quot;:1.1}" /><SubmitButton>Save advanced model</SubmitButton></ActionForm></section>
    <section className="max-w-2xl border border-[var(--rule)] bg-white p-6"><h2 className="text-2xl font-semibold">Causal demand event</h2><p className="mt-2 text-sm text-[var(--muted)]">Add a holiday, school closure, distribution drive, or other event that predictably changes demand.</p><ActionForm action={saveCausalEventAction.bind(null, context.access.organization.id, organizationSlug, context.activeLocation.id)} className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Event name" name="name" required /><Field label="Demand multiplier" name="demandMultiplier" type="number" min="0.1" max="10" step="0.05" defaultValue="1.25" required /><Field label="Starts" name="startsOn" type="date" required /><Field label="Ends" name="endsOn" type="date" required /><Field label="Notes" name="notes" /><div><SubmitButton>Save causal event</SubmitButton></div></ActionForm></section>
  </div>;
}
