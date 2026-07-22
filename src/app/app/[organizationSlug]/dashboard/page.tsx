import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getMemberCountForUser } from "@/domains/admin/queries";
import { getTodayAtGlance } from "@/domains/dashboard/queries";
import { queueDueAppointmentRemindersAction } from "@/domains/messaging/actions";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const mayViewMembers = can(context.effectivePermissions, "member.view");
  let memberCount: number | null = null;
  if (mayViewMembers) {
    memberCount = await getMemberCountForUser(context.user.id, context.access.organization.id);
  }
  const location = context.activeLocation;
  const mayViewAppointments = can(context.effectivePermissions, "appointment.view");
  const mayViewInventory = can(context.effectivePermissions, "inventory.view");
  const mayViewAlerts = can(context.effectivePermissions, "alert.view");
  const mayViewInboundMessages = can(context.effectivePermissions, "message.view_inbound");
  const today = location
    ? await getTodayAtGlance(context.access.organization.id, location.id, {
        appointments: mayViewAppointments,
        inventory: mayViewInventory,
        alerts: mayViewAlerts,
        inboundMessages: mayViewInboundMessages,
      })
    : null;
  const base = `/app/${organizationSlug}`;
  const todayMetrics = [
    ...(mayViewAppointments ? [{ label: "Pickups due", value: today?.pickups?.due ?? 0, detail: `${today?.pickups?.arrived ?? 0} checked in` }] : []),
    ...(mayViewAlerts ? [{ label: "Low-stock signals", value: today?.alerts?.low_stock ?? 0, detail: `${today?.alerts?.unresolved ?? 0} unresolved alerts` }] : []),
    ...(mayViewInventory ? [{ label: "Lots to review", value: today?.inventory?.expiring ?? 0, detail: "expired, missing date, or within 30 days" }] : []),
    ...(mayViewInboundMessages ? [{ label: "Messages needing review", value: today?.messages?.awaiting_review ?? 0, detail: "inbound replies awaiting staff" }] : []),
  ];
  const activeRoles = context.access.assignments
    .filter((assignment) => assignment.locationId === null || assignment.locationId === location?.id)
    .map((assignment) => assignment.roleSlug);
  const shiftFocus = activeRoles.includes("administrator")
    ? "Review system health, unresolved alerts, and team access before opening the day."
    : activeRoles.includes("pantry-manager")
      ? "Clear today’s pickup queue, review active reservations, and resolve urgent operational alerts."
      : activeRoles.includes("inventory-worker")
        ? "Receive verified stock, use barcode lookup to avoid duplicate items, and document every adjustment reason."
        : activeRoles.includes("volunteer")
          ? "Use the pickup queue to check in households and ask a manager before making stock or membership changes."
          : "Review the current location context and use the sections you are permitted to view.";
  const setupChecks = [
    Boolean(context.profile?.displayName),
    context.access.locations.length > 0,
    context.access.assignments.some(
      (assignment) => assignment.roleSlug === "administrator",
    ),
    can(context.effectivePermissions, "forecast.view"),
    can(context.effectivePermissions, "message.settings.manage"),
    can(context.effectivePermissions, "report.view"),
  ];
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Foundation dashboard"
        title={context.access.organization.name}
        description="Identity, organization, location, authorization, inventory, and pickup operations for the active pantry."
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="border border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Organization status</p>
          <div className="mt-6">
            <StatusBadge status={context.access.organization.status} />
          </div>
        </article>
        <article className="border border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Current location</p>
          <p className="mt-6 text-2xl font-semibold tracking-[-0.03em]">
            {context.activeLocation?.name ?? "No active location"}
          </p>
        </article>
        <article className="border border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Active locations</p>
          <p className="tabular mt-6 text-5xl font-semibold">
            {context.access.locations.length}
          </p>
        </article>
        {memberCount !== null ? (
          <article className="border border-[var(--rule)] bg-white p-5">
            <p className="text-sm text-[var(--muted)]">Team members</p>
            <p className="tabular mt-6 text-5xl font-semibold">{memberCount}</p>
          </article>
        ) : null}
      </section>
      {location ? (
        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <article className="border border-[var(--rule)] bg-white p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--signal)]">Today at a glance</p>
                <h2 className="mt-1 text-2xl font-semibold">{location.name}</h2>
              </div>
              {today?.pickups?.next_appointment_id ? (
                <Link className="text-sm font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4" href={`${base}/pickups/appointments/${today.pickups.next_appointment_id}`}>
                  Open next pickup
                </Link>
              ) : null}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {todayMetrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-[var(--rule-soft)] bg-[var(--surface)] p-4">
                  <p className="text-xs text-[var(--muted)]">{metric.label}</p>
                  <p className="tabular mt-2 text-3xl font-semibold">{metric.value}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{metric.detail}</p>
                </div>
              ))}
            </div>
            {today?.pickups?.next_household_name ? (
              <div className="mt-5 rounded-xl border-l-4 border-[var(--signal)] bg-[var(--surface)] px-4 py-3 text-sm">
                <strong>Next pickup:</strong> {today.pickups.next_household_name}
                {today.pickups.next_start_at ? ` · ${new Date(today.pickups.next_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                {today.pickups.next_status ? ` · ${today.pickups.next_status.replaceAll("_", " ")}` : ""}
              </div>
            ) : null}
          </article>
          <article className="border border-[var(--rule)] bg-white p-6">
            <p className="text-sm font-semibold text-[var(--signal)]">Quick actions</p>
            <h2 className="mt-1 text-2xl font-semibold">Start the next task</h2>
            <div className="mt-5 grid gap-3">
              {can(context.effectivePermissions, "receiving.create") ? <Link className="rounded-xl border border-[var(--rule)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--ink)] hover:bg-[var(--surface)]" href={`${base}/inventory/receiving`}>Receive a donation or purchase</Link> : null}
              {can(context.effectivePermissions, "inventory.adjust") ? <Link className="rounded-xl border border-[var(--rule)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--ink)] hover:bg-[var(--surface)]" href={`${base}/inventory/adjustments`}>Adjust stock</Link> : null}
              {can(context.effectivePermissions, "appointment.create") ? <Link className="rounded-xl border border-[var(--rule)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--ink)] hover:bg-[var(--surface)]" href={`${base}/pickups/appointments/new`}>Schedule a pickup</Link> : null}
              {can(context.effectivePermissions, "pickup.complete") && today?.pickups?.next_appointment_id ? <Link className="rounded-xl border border-[var(--rule)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--ink)] hover:bg-[var(--surface)]" href={`${base}/pickups/appointments/${today.pickups.next_appointment_id}`}>Mark the next pickup complete</Link> : null}
              {can(context.effectivePermissions, "message.schedule") ? <ActionForm action={queueDueAppointmentRemindersAction.bind(null, context.access.organization.id, organizationSlug, location.id)} className="grid gap-2"><SubmitButton variant="secondary" className="justify-start rounded-xl px-4 py-3">Queue due appointment reminders</SubmitButton></ActionForm> : null}
            </div>
          </article>
        </section>
      ) : null}
      <section className="rounded-2xl border border-[var(--rule)] bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--signal)]">Your shift focus</p><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{shiftFocus}</p></div><Link className="text-sm font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4" href={`${base}/help`}>Open role guidance</Link></div></section>
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-2xl font-semibold">Operations setup checklist</h2>
          <p className="tabular mt-3 text-sm text-[var(--muted)]">
            {setupChecks.filter(Boolean).length} of {setupChecks.length}{" "}
            required checks complete
          </p>
          <ul className="mt-6 grid gap-3">
            {[
              ["User profile", setupChecks[0]],
              ["Active pantry location", setupChecks[1]],
              ["Administrator assignment", setupChecks[2]],
              ["Forecast access", setupChecks[3]],
              ["Messaging configuration access", setupChecks[4]],
              ["Reporting access", setupChecks[5]],
            ].map(([label, complete]) => (
              <li
                key={String(label)}
                className="flex justify-between border-b border-[var(--rule)] pb-3 text-sm last:border-b-0"
              >
                <span>{label}</span>
                <strong
                  className={
                    complete ? "text-[var(--success)]" : "text-[var(--signal)]"
                  }
                >
                  {complete ? "Complete" : "Needs attention"}
                </strong>
              </li>
            ))}
          </ul>
        </article>
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-2xl font-semibold">Next administration tasks</h2>
          <div className="mt-6 grid gap-3">
            {can(context.effectivePermissions, "location.create") ? (
              <Link
                className="rounded-lg border-b border-[var(--rule)] pb-3 font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--signal)]"
                href={`/app/${organizationSlug}/locations/new`}
              >
                Create another pantry location
              </Link>
            ) : null}
            {can(context.effectivePermissions, "member.invite") ? (
              <Link
                className="rounded-lg border-b border-[var(--rule)] pb-3 font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--signal)]"
                href={`/app/${organizationSlug}/team`}
              >
                Prepare a team invitation
              </Link>
            ) : null}
            {can(context.effectivePermissions, "appointment.view") ? (
              <Link
                className="rounded-lg border-b border-[var(--rule)] pb-3 font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--signal)]"
                href={`/app/${organizationSlug}/pickups`}
              >
                View pickup schedule
              </Link>
            ) : null}
            {can(context.effectivePermissions, "forecast.view") ? (
              <Link className="rounded-lg border-b border-[var(--rule)] pb-3 font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--signal)]" href={`/app/${organizationSlug}/forecast`}>
                Review forecast and shortages
              </Link>
            ) : null}
            <Link
              className="rounded-lg border-b border-[var(--rule)] pb-3 font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--signal)]"
              href="/profile"
            >
              Review your profile
            </Link>
          </div>
        </article>
      </section>
    </div>
  );
}
