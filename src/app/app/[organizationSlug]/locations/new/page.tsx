import { notFound } from "next/navigation";
import { LocationForm } from "@/components/locations/location-form";
import { PageHeader } from "@/components/ui/page-header";
import { createLocationAction } from "@/domains/admin/actions";
import { can, requireOrganizationContext } from "@/lib/auth/access";

export default async function NewLocationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "location.create")) notFound();
  const action = createLocationAction.bind(
    null,
    context.access.organization.id,
    organizationSlug,
  );
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Locations / New"
        title="Create a pantry location"
        description="The location is created inside the active organization. No inventory records are created in this phase."
      />
      <LocationForm
        action={action}
        includeSlug
        submitLabel="Create location"
        values={{
          timezone: context.access.organization.timezone,
          country_code: "US",
        }}
      />
    </div>
  );
}
