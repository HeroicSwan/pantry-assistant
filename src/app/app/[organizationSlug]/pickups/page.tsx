import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getPickupDashboard, listAppointments } from "@/domains/pickups/queries";

export default async function PickupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { organizationSlug } = await params;
  const { date } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "appointment.view")) notFound();
  const location = context.activeLocation;
  const base = `/app/${organizationSlug}/pickups`;

  if (!location) {
    return (
      <div className="grid gap-10">
        <PageHeader eyebrow="Pickups" title="Pickup schedule" description="Select an active pantry location to view its appointments." />
        <EmptyState title="No active location" description="Choose a pantry location from the scope switcher." />
      </div>
    );
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? (date as string) : new Date().toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const previousDay = new Date(from.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nextDay = to.toISOString().slice(0, 10);

  const [summary, rows] = await Promise.all([
    getPickupDashboard(context.access.organization.id, location.id),
    listAppointments(context.access.organization.id, location.id, { from, to }),
  ]);
  const mayCreate = can(context.effectivePermissions, "appointment.create");

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Pickups"
        title={`Pickups · ${location.name}`}
        description="Appointments, check-in, and reservation state for the active location. Reservations hold available stock; the ledger changes only when a pickup is completed."
        actions={
          <div className="flex flex-wrap gap-2">
            {mayCreate ? (
              <Link href={`${base}/appointments/new`} className="inline-flex min-h-11 items-center border border-[var(--signal)] bg-[var(--signal)] px-4 text-sm font-semibold text-white">New appointment</Link>
            ) : null}
            {can(context.effectivePermissions, "package.view") ? (
              <Link href={`${base}/packages`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Packages</Link>
            ) : null}
            {can(context.effectivePermissions, "household.view_basic") ? (
              <Link href={`/app/${organizationSlug}/households`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Households</Link>
            ) : null}
          </div>
        }
      />

      <section className="grid border-t border-l border-[var(--rule)] sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Today", summary?.today_total ?? "0"],
          ["Checked in", summary?.checked_in ?? "0"],
          ["Completed today", summary?.completed_today ?? "0"],
          ["Active reservations", summary?.active_reservations ?? "0"],
          ["Expiring < 24h", summary?.expiring_soon ?? "0"],
          ["No-shows today", summary?.no_shows_today ?? "0"],
        ].map(([label, value]) => (
          <article key={label} className="border-r border-b border-[var(--rule)] bg-white p-4">
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p className="tabular mt-3 text-3xl font-semibold">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Schedule · {day}</h2>
          <div className="flex gap-3 text-sm font-semibold">
            <Link className="underline" href={`${base}?date=${previousDay}`}>← {previousDay}</Link>
            <Link className="underline" href={`${base}?date=${nextDay}`}>{nextDay} →</Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No appointments" description={`No appointments are scheduled at ${location.name} on ${day}.`} />
        ) : (
          <div className="overflow-x-auto border border-[var(--rule)]">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">
                  <th className="p-3 font-semibold">Time</th>
                  <th className="p-3 font-semibold">Household</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold">Package</th>
                  <th className="p-3 font-semibold">Reservation</th>
                  <th className="p-3 font-semibold">Alerts</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--rule)] last:border-b-0">
                    <td className="tabular p-3">{row.scheduled_start_at.slice(11, 16)}–{row.scheduled_end_at.slice(11, 16)}</td>
                    <td className="p-3">
                      <Link className="font-semibold underline" href={`${base}/appointments/${row.id}`}>{row.household_name}</Link>
                      <span className="ml-2 text-xs text-[var(--muted)]">size {row.household_size_snapshot}</span>
                    </td>
                    <td className="p-3 text-[var(--muted)]">{row.appointment_type.replaceAll("_", " ")}</td>
                    <td className="p-3 text-[var(--muted)]">{row.package_name ?? "—"}</td>
                    <td className="p-3">{row.reservation_status ? <StatusBadge status={row.reservation_status} /> : <span className="text-xs text-[var(--muted)]">none</span>}</td>
                    <td className="p-3 text-xs font-semibold text-[var(--signal)]">{row.critical_flags ?? ""}</td>
                    <td className="p-3"><StatusBadge status={row.status} /></td>
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
