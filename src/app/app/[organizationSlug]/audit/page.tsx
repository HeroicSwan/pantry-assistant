import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField, Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getAuditDataForUser } from "@/domains/admin/queries";

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    action?: string;
    actor?: string;
    entity?: string;
    location?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { organizationSlug } = await params;
  const filters = await searchParams;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "audit.view")) notFound();
  const auditData = await getAuditDataForUser(context.user.id, context.access.organization.id, filters);
  if (!auditData) notFound();
  const { logs, actors } = auditData;
  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="Append-only administrative events. Values are minimized and correlated by request identifier."
      />
      <form className="grid gap-4 border border-[var(--rule)] bg-white p-5 sm:grid-cols-2 lg:grid-cols-6">
        <Field
          label="Action contains"
          name="action"
          defaultValue={filters.action ?? ""}
        />
        <SelectField
          label="Actor"
          name="actor"
          defaultValue={filters.actor ?? ""}
        >
          <option value="">All actors</option>
          {(actors ?? []).map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.display_name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Entity type"
          name="entity"
          defaultValue={filters.entity ?? ""}
        />
        <SelectField
          label="Location"
          name="location"
          defaultValue={filters.location ?? ""}
        >
          <option value="">All locations</option>
          {context.access.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </SelectField>
        <Field
          label="From"
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
        />
        <Field
          label="To"
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
        />
        <Button type="submit" className="lg:col-span-6 lg:justify-self-start">
          Apply filters
        </Button>
      </form>
      <div className="overflow-x-auto border border-[var(--rule)] bg-white">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--ink)]">
              <th className="p-3">Time</th>
              <th className="p-3">Action</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Entity</th>
              <th className="p-3">Location</th>
              <th className="p-3">Source</th>
              <th className="p-3">Request</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((log) => {
              const actor = (actors ?? []).find(
                (item) => item.id === log.actor_user_id,
              );
              return (
                <tr
                  key={log.id}
                  className="border-b border-[var(--rule)] last:border-b-0"
                >
                  <td className="tabular p-3">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 font-semibold">{log.action}</td>
                  <td className="p-3">{actor?.display_name ?? "System"}</td>
                  <td className="p-3">{log.entity_type}</td>
                  <td className="p-3">
                    {context.access.locations.find(
                      (item) => item.id === log.location_id,
                    )?.name ?? "Organization"}
                  </td>
                  <td className="p-3">{log.source.replaceAll("_", " ")}</td>
                  <td className="tabular p-3 text-xs">{log.request_id}</td>
                </tr>
              );
            })}
            {!logs?.length ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--muted)]">
                  No audit events match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
