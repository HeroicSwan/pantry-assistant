import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { reportDefinitions, reportTypes } from "@/domains/reports/policy";
import { can, requireOrganizationContext } from "@/lib/auth/access";

const groups = [
  ["Inventory", ["inventory-on-hand", "expiring-inventory", "inventory-quality", "inventory-transactions", "inventory-count-sheet", "transfers", "transfer-manifest"]],
  ["Donations and receiving", ["donations", "donor-contributions", "receiving"]],
  ["Households and distribution", ["distributions", "pickup-schedule"]],
  ["Forecast and operations", ["forecasts", "donation-needs", "alerts", "weekly-summary"]],
  ["Messaging", ["messaging"]],
] as const;

export default async function ReportsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "report.view")) notFound();
  if (!context.activeLocation) {
    return <EmptyState title="No active location" description="Select a pantry location before opening reports." />;
  }
  const visible = new Set(reportTypes.filter((type) => can(context.effectivePermissions, reportDefinitions[type].permission)));
  return (
    <div className="grid gap-10">
      <PageHeader eyebrow="Operations" title={`Reports · ${context.activeLocation.name}`} description="Canonical operational reports use the same ledger, reservation, fulfillment, forecast, and message records as the rest of the application." />
      {visible.size === 0 ? <EmptyState title="No reports available" description="Your role does not include access to a report category at this location." /> : groups.map(([label, types]) => {
        const available = types.filter((type) => visible.has(type));
        if (available.length === 0) return null;
        return <section key={label} className="grid gap-4"><h2 className="text-2xl font-semibold">{label}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{available.map((type) => {
          const definition = reportDefinitions[type];
          return <Link key={type} href={`/app/${organizationSlug}/reports/${type}`} className="border border-[var(--rule)] bg-white p-5 transition hover:border-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2"><h3 className="font-semibold">{definition.title}</h3><p className="mt-2 text-sm text-[var(--muted)]">{definition.description}</p>{definition.printable ? <p className="mt-3 text-xs font-semibold uppercase tracking-wide">Print view available</p> : null}</Link>;
        })}</div></section>;
      })}
    </div>
  );
}

