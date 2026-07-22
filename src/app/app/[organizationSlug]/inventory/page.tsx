import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BarcodeLookup } from "@/components/inventory/barcode-lookup";
import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getInventorySummary, listItemsWithBalances } from "@/domains/inventory/queries";
import { formatQuantity } from "@/domains/inventory/format";

export default async function InventoryOverviewPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ q?: string; stock?: string }> }) {
  const { organizationSlug } = await params;
  const { q, stock } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();

  const base = `/app/${organizationSlug}/inventory`;
  const location = context.activeLocation;
  if (!location) {
    return (
      <div className="grid gap-10">
        <PageHeader eyebrow="Inventory operations" title="Inventory" description="Physical stock is tracked as an append-only, lot-level ledger. Balances are always derived from posted transactions." />
        <EmptyState title="No active location" description="Select or request access to a pantry location to view its inventory." />
      </div>
    );
  }

  const [summary, items] = await Promise.all([
    getInventorySummary(context.access.organization.id, location.id),
    listItemsWithBalances(context.access.organization.id, location.id, { query: q, stock: stock === "available" || stock === "needs_review" ? stock : "all" }),
  ]);

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory operations"
        title={`Inventory · ${location.name}`}
        description="Available stock excludes expired, archived, quarantined, and recalled lots. Physical balances remain fully traceable through the append-only ledger."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/activity`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Activity</Link>
            {can(context.effectivePermissions, "receiving.view") ? <Link href={`${base}/receiving`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Receiving</Link> : null}
            {can(context.effectivePermissions, "donor.view") ? <Link href={`${base}/donors`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Donors</Link> : null}
            <Link href={`${base}/adjustments`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Adjustments</Link>
            <Link href={`${base}/conditions`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Condition</Link>
            <Link href={`${base}/counts`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Counts</Link>
            <Link href={`${base}/transfers`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Transfers</Link>
            {can(context.effectivePermissions, "inventory.manage_catalog") ? (
              <Link href={`${base}/catalog`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Catalog</Link>
            ) : null}
            <Link href={`${base}/storage`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Storage</Link>
          </div>
        }
      />

      <section className="grid border-t border-l border-[var(--rule)] sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Items with stock", summary?.items_with_stock ?? "0"],
          ["Active lots", summary?.total_lots ?? "0"],
          ["Expired lots", summary?.expired_lots ?? "0"],
          ["Storage locations", summary?.storage_locations ?? "0"],
        ].map(([label, value]) => (
          <article key={label} className="border-r border-b border-[var(--rule)] bg-white p-5">
            <p className="text-sm text-[var(--muted)]">{label}</p>
            <p className="tabular mt-6 text-4xl font-semibold">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
        <InventoryFilters />
        <BarcodeLookup organizationSlug={organizationSlug} />
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-2xl font-semibold">Items</h2><p className="text-sm text-[var(--muted)]">{items.length} matching item{items.length === 1 ? "" : "s"}</p></div>
        {items.length === 0 ? (
          <EmptyState title="No items yet" description="An administrator defines the item catalog before stock is received." />
        ) : (
          <div className="overflow-x-auto border border-[var(--rule)]">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">
                  <th className="p-3 font-semibold">Item</th>
                  <th className="p-3 font-semibold">Category</th>
                  <th className="tabular p-3 text-right font-semibold">On hand</th>
                  <th className="tabular p-3 text-right font-semibold">Valid</th>
                  <th className="tabular p-3 text-right font-semibold">Available</th>
                  <th className="tabular p-3 text-right font-semibold">Expired</th>
                  <th className="p-3 font-semibold">Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--rule)] last:border-b-0">
                    <td className="p-3">
                      <Link className="font-semibold underline" href={`${base}/items/${item.id}`}>{item.name}</Link>
                      {item.status === "archived" ? <span className="ml-2 text-xs text-[var(--muted)]">archived</span> : null}
                    </td>
                    <td className="p-3 text-[var(--muted)]">{item.category_name ?? "—"}</td>
                    <td className="tabular p-3 text-right">{formatQuantity(item.physical_on_hand)}</td>
                    <td className="tabular p-3 text-right">{formatQuantity(item.valid_on_hand)}</td>
                    <td className="tabular p-3 text-right font-semibold">{formatQuantity(item.available_quantity)}</td>
                    <td className="tabular p-3 text-right text-[var(--signal)]">{formatQuantity(item.expired_quantity)}</td>
                    <td className="p-3 text-[var(--muted)]">{item.base_unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
