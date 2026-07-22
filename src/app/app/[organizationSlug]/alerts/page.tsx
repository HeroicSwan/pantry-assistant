import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  acknowledgeOpenAlertsAction,
  alertTransitionAction,
} from "@/domains/forecasting/actions";
import { listAlerts } from "@/domains/forecasting/queries";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationSlug } = await params;
  const { status } = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "alert.view")) notFound();
  const location = context.activeLocation;
  if (!location) notFound();
  const organizationId = context.access.organization.id;
  const rows = await listAlerts(organizationId, location.id, status);
  const canAcknowledge = can(context.effectivePermissions, "alert.acknowledge");
  const canManage = can(context.effectivePermissions, "alert.manage");

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Operational alerts"
        title={`Alert center · ${location.name}`}
        description="Forecast alerts are deduplicated signals. Acknowledging, resolving, or dismissing an alert never mutates inventory, appointments, or reservations."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Alert status"
          className="flex gap-3 text-sm font-semibold"
        >
          <a href="?status=open">Open</a>
          <a href="?status=acknowledged">Acknowledged</a>
          <a href="?status=resolved">Resolved</a>
          <a href="?">All</a>
        </nav>
        {status !== "acknowledged" && canAcknowledge ? (
          <ActionForm
            action={acknowledgeOpenAlertsAction.bind(
              null,
              organizationId,
              organizationSlug,
              location.id,
            )}
            className="flex"
          >
            <SubmitButton pendingLabel="Acknowledging alerts…">
              Acknowledge all open
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>
      <section className="grid gap-4">
        {rows.map((alert) => (
          <article
            key={alert.id}
            className="border border-[var(--rule)] bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{alert.title}</h2>
              <div className="flex gap-2">
                <StatusBadge status={alert.severity} />
                <StatusBadge status={alert.status} />
              </div>
            </div>
            <p className="mt-3 text-sm">{alert.summary}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Detected {alert.occurrence_count} time(s) · last{" "}
              {new Date(alert.last_detected_at).toLocaleString()}
            </p>
            {alert.status === "open" && canAcknowledge ? (
              <ActionForm
                action={alertTransitionAction.bind(
                  null,
                  organizationId,
                  organizationSlug,
                  location.id,
                  alert.id,
                  "acknowledged",
                )}
                className="mt-4"
              >
                <input
                  type="hidden"
                  name="reason"
                  value="Reviewed by operator"
                />
                <SubmitButton pendingLabel="Acknowledging…">
                  Acknowledge
                </SubmitButton>
              </ActionForm>
            ) : null}
            {canManage && !["resolved", "dismissed"].includes(alert.status) ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ActionForm
                  action={alertTransitionAction.bind(
                    null,
                    organizationId,
                    organizationSlug,
                    location.id,
                    alert.id,
                    "resolved",
                  )}
                >
                  <Field label="Resolution note" name="reason" required />
                  <SubmitButton pendingLabel="Resolving…">Resolve</SubmitButton>
                </ActionForm>
                <ActionForm
                  action={alertTransitionAction.bind(
                    null,
                    organizationId,
                    organizationSlug,
                    location.id,
                    alert.id,
                    "dismissed",
                  )}
                >
                  <Field label="Dismissal reason" name="reason" required />
                  <SubmitButton pendingLabel="Dismissing…" variant="secondary">
                    Dismiss
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : null}
          </article>
        ))}
        {rows.length === 0 ? (
          <p className="border border-dashed border-[var(--rule)] bg-white p-6 text-sm text-[var(--muted)]">
            No alerts match this status. Recalculate the forecast if you expect
            new operational signals.
          </p>
        ) : null}
      </section>
    </div>
  );
}
