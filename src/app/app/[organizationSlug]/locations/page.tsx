import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getLocationsForUser } from "@/domains/admin/queries";

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  const mayCreate = can(context.effectivePermissions, "location.create");
  const locations = await getLocationsForUser(context.user.id, context.access.organization.id);
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Locations"
        title="Pantry locations"
        description="Location access is resolved from organization permissions and explicit location assignments."
        actions={
          mayCreate ? (
            <Link href={`/app/${organizationSlug}/locations/new`}>
              <Button>Create location</Button>
            </Link>
          ) : undefined
        }
      />
      {!locations?.length ? (
        <EmptyState
          title="No accessible locations"
          description="An organization administrator must create or assign a pantry location."
        />
      ) : (
        <div className="grid border-t border-l border-[var(--rule)] md:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <Link
              key={location.id}
              href={`/app/${organizationSlug}/locations/${location.id}`}
              className="border-r border-b border-[var(--rule)] bg-white p-5 hover:bg-[var(--surface)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">{location.name}</h2>
                <StatusBadge status={location.status} />
              </div>
              <p className="mt-8 text-sm text-[var(--muted)]">
                {[location.city, location.state_region]
                  .filter(Boolean)
                  .join(", ") || "No city or region recorded"}
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {location.timezone ?? context.access.organization.timezone}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
