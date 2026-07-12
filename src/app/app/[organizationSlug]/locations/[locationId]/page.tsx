import { notFound } from "next/navigation";
import { LocationForm } from "@/components/locations/location-form";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  archiveLocationAction,
  updateLocationAction,
} from "@/domains/admin/actions";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { verifyLocationPermission } from "@/lib/auth/access";
import { getLocationForUser } from "@/domains/admin/queries";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; locationId: string }>;
}) {
  const { organizationSlug, locationId } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const location = await getLocationForUser(context.user.id, context.access.organization.id, locationId);
  if (!location) notFound();
  const mayUpdate =
    location.status !== "archived" &&
    (await verifyLocationPermission(locationId, "location.update"));
  const mayArchive =
    location.status !== "archived" &&
    can(context.effectivePermissions, "location.archive");
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow={`Locations / ${location.slug}`}
        title={location.name}
        description="Location details, closure status, and administrative lifecycle."
        actions={<StatusBadge status={location.status} />}
      />
      {mayUpdate ? (
        <LocationForm
          action={updateLocationAction.bind(null, locationId, organizationSlug)}
          values={location}
          submitLabel="Save location"
        />
      ) : (
        <p className="border border-[var(--rule)] bg-white p-5 text-sm text-[var(--muted)]">
          This location is read-only for your current permission scope.
        </p>
      )}
      {mayArchive ? (
        <section className="max-w-4xl border-t-4 border-[var(--signal)] bg-white p-6">
          <h2 className="text-xl font-semibold">Archive location</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Archival removes the location from operational navigation and
            archives location-scoped assignments. The final active location
            cannot be archived.
          </p>
          <ActionForm
            action={archiveLocationAction.bind(
              null,
              locationId,
              organizationSlug,
            )}
            className="mt-5 grid gap-4"
          >
            <Field label="Reason" name="reason" required />
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="confirm"
                value="archive"
                required
                className="mt-1"
              />
              I understand this location will no longer accept operational
              records.
            </label>
            <SubmitButton variant="danger" pendingLabel="Archiving…">
              Archive location
            </SubmitButton>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
