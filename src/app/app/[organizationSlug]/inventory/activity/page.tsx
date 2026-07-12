import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { listActivity } from "@/domains/inventory/queries";
import { formatQuantity, transactionLabel } from "@/domains/inventory/format";

const PAGE_SIZE = 50;

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { organizationSlug } = await params;
  const { page } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();
  const location = context.activeLocation;
  const pageNumber = Math.max(1, Number(page ?? "1") || 1);
  const offset = (pageNumber - 1) * PAGE_SIZE;

  const rows = location ? await listActivity(context.access.organization.id, location.id, PAGE_SIZE + 1, offset) : [];
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  const base = `/app/${organizationSlug}/inventory`;

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory operations"
        title="Activity history"
        description="Every posted inventory transaction at the active location, newest first. History is immutable; corrections appear as reversals and replacements."
      />
      {!location ? (
        <EmptyState title="No active location" description="Select a pantry location to view its inventory activity." />
      ) : visible.length === 0 ? (
        <EmptyState title="No activity yet" description="Posted receiving, adjustments, and reversals will appear here." />
      ) : (
        <>
          <div className="overflow-x-auto border border-[var(--rule)]">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">
                  <th className="p-3 font-semibold">When</th>
                  <th className="p-3 font-semibold">Item</th>
                  <th className="p-3 font-semibold">Lot</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="tabular p-3 text-right font-semibold">Delta</th>
                  <th className="p-3 font-semibold">Actor</th>
                  <th className="p-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const delta = Number(row.physical_delta);
                  return (
                    <tr key={row.id} className="border-b border-[var(--rule)] last:border-b-0">
                      <td className="tabular p-3">{row.occurred_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="p-3">{row.item_name}</td>
                      <td className="p-3">
                        <Link className="underline" href={`${base}/lots/${row.lot_id}`}>{row.lot_code ?? row.lot_id.slice(0, 8)}</Link>
                      </td>
                      <td className="p-3">{transactionLabel(row.transaction_type)}</td>
                      <td className={`tabular p-3 text-right font-semibold ${delta < 0 ? "text-[var(--signal)]" : "text-[var(--success)]"}`}>{delta > 0 ? "+" : ""}{formatQuantity(row.physical_delta)}</td>
                      <td className="p-3 text-[var(--muted)]">{row.actor_name ?? "—"}</td>
                      <td className="p-3 text-[var(--muted)]">{row.reason ?? row.reason_code ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-sm">
            {pageNumber > 1 ? <Link className="font-semibold underline" href={`${base}/activity?page=${pageNumber - 1}`}>← Newer</Link> : <span />}
            {hasNext ? <Link className="font-semibold underline" href={`${base}/activity?page=${pageNumber + 1}`}>Older →</Link> : <span />}
          </div>
        </>
      )}
    </div>
  );
}
