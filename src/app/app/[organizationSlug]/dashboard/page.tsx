import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getMemberCountForUser } from "@/domains/admin/queries";

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
      <section className="grid border-t border-l border-[var(--rule)] sm:grid-cols-2 xl:grid-cols-4">
        <article className="border-r border-b border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Organization status</p>
          <div className="mt-6">
            <StatusBadge status={context.access.organization.status} />
          </div>
        </article>
        <article className="border-r border-b border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Current location</p>
          <p className="mt-6 text-2xl font-semibold tracking-[-0.03em]">
            {context.activeLocation?.name ?? "No active location"}
          </p>
        </article>
        <article className="border-r border-b border-[var(--rule)] bg-white p-5">
          <p className="text-sm text-[var(--muted)]">Active locations</p>
          <p className="tabular mt-6 text-5xl font-semibold">
            {context.access.locations.length}
          </p>
        </article>
        {memberCount !== null ? (
          <article className="border-r border-b border-[var(--rule)] bg-white p-5">
            <p className="text-sm text-[var(--muted)]">Team members</p>
            <p className="tabular mt-6 text-5xl font-semibold">{memberCount}</p>
          </article>
        ) : null}
      </section>
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
                className="flex justify-between border-b border-[var(--rule)] pb-3 text-sm"
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
                className="border-b border-[var(--rule)] pb-3 font-semibold underline"
                href={`/app/${organizationSlug}/locations/new`}
              >
                Create another pantry location
              </Link>
            ) : null}
            {can(context.effectivePermissions, "member.invite") ? (
              <Link
                className="border-b border-[var(--rule)] pb-3 font-semibold underline"
                href={`/app/${organizationSlug}/team`}
              >
                Prepare a team invitation
              </Link>
            ) : null}
            {can(context.effectivePermissions, "appointment.view") ? (
              <Link
                className="border-b border-[var(--rule)] pb-3 font-semibold underline"
                href={`/app/${organizationSlug}/pickups`}
              >
                View pickup schedule
              </Link>
            ) : null}
            {can(context.effectivePermissions, "forecast.view") ? (
              <Link className="border-b border-[var(--rule)] pb-3 font-semibold underline" href={`/app/${organizationSlug}/forecast`}>
                Review forecast and shortages
              </Link>
            ) : null}
            <Link
              className="border-b border-[var(--rule)] pb-3 font-semibold underline"
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
