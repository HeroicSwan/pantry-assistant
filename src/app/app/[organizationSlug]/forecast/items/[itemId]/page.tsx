import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getItemForecast } from "@/domains/forecasting/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function ItemForecastPage({ params }: { params: Promise<{ organizationSlug: string; itemId: string }> }) {
  const { organizationSlug, itemId } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "forecast.view_item") && !can(context.effectivePermissions, "forecast.view")) notFound();
  if (!context.activeLocation) notFound();
  const data = await getItemForecast(context.access.organization.id, context.activeLocation.id, itemId);
  if (!data) notFound();
  const r = data.result;
  const explanation = r.explanation as Record<string, unknown>;
  const metrics: Array<[string, React.ReactNode]> = [
    ["Observed available", `${Number(r.available_quantity).toFixed(2)} ${String(r.base_unit)}`],
    ["Derived daily demand", r.weighted_daily_demand === null ? "Insufficient data" : Number(r.weighted_daily_demand).toFixed(2)],
    ["Forecast risk", <StatusBadge key="risk" status={String(r.risk_level)} />],
    ["Reserved", Number(r.reserved_quantity).toFixed(2)],
    ["Unreserved scheduled", Number(r.scheduled_unreserved).toFixed(2)],
    ["Confirmed incoming", Number(r.confirmed_incoming).toFixed(2)],
    ["Expiring in horizon", Number(r.expiring_before_use).toFixed(2)],
    ["Safety stock", Number(r.safety_stock).toFixed(2)],
    ["Recommended additional", Number(r.recommended_quantity).toFixed(2)],
  ];
  return <div className="grid gap-10">
    <PageHeader eyebrow="Item forecast" title={String(r.name)} description={`Snapshot ${new Date(String(r.generated_at)).toLocaleString()} · horizon ${String(r.horizon_end)}`} />
    <section className="grid gap-3 sm:grid-cols-3">{metrics.map(([label, value]) => <article key={label} className="border border-[var(--rule)] bg-white p-5"><p className="text-xs text-[var(--muted)]">{label}</p><div className="mt-3 text-xl font-semibold">{value}</div></article>)}</section>
    <section className="border border-[var(--rule)] bg-white p-6"><h2 className="text-xl font-semibold">Calculation explanation</h2><pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(explanation, null, 2)}</pre></section>
    {data.diagnostics.length ? <section><h2 className="text-xl font-semibold">Diagnostics</h2><ul className="mt-3 grid gap-2">{data.diagnostics.map((diagnostic) => <li key={diagnostic.code} className="border-l-4 border-[var(--signal)] bg-white p-3 text-sm"><strong>{diagnostic.code}</strong> · {diagnostic.message}</li>)}</ul></section> : null}
  </div>;
}
