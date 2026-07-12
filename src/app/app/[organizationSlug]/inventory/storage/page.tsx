import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Field, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { listStorageLocations } from "@/domains/inventory/queries";
import { createStorageLocationAction } from "@/domains/inventory/actions";

export default async function StoragePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();
  const organizationId = context.access.organization.id;
  const location = context.activeLocation;
  const mayReceive = can(context.effectivePermissions, "inventory.receive");

  const storage = location ? await listStorageLocations(organizationId, location.id) : [];

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory storage"
        title="Storage locations"
        description="Storage locations (bins, shelves, coolers, freezers) organize where lots physically sit within a pantry location."
      />
      {!location ? (
        <EmptyState title="No active location" description="Select a pantry location to manage its storage locations." />
      ) : (
        <section className="grid gap-6 lg:grid-cols-2">
          <article className="border border-[var(--rule)] bg-white p-6">
            <h2 className="text-xl font-semibold">{location.name} storage ({storage.length})</h2>
            <ul className="mt-4 grid gap-2 text-sm">
              {storage.map((entry) => (
                <li key={entry.id} className="flex justify-between border-b border-[var(--rule)] pb-2">
                  <span className="font-semibold">{entry.name}{entry.code ? <span className="text-[var(--muted)]"> · {entry.code}</span> : null}</span>
                  <span className="text-[var(--muted)]">{entry.status}</span>
                </li>
              ))}
              {storage.length === 0 ? <li className="text-[var(--muted)]">No storage locations yet.</li> : null}
            </ul>
          </article>
          {mayReceive ? (
            <article className="border border-[var(--rule)] bg-white p-6">
              <h2 className="text-xl font-semibold">New storage location</h2>
              <ActionForm action={createStorageLocationAction.bind(null, organizationId, organizationSlug, location.id)} className="mt-4 grid gap-4">
                <Field label="Name" name="name" required maxLength={80} placeholder="Dry storage A" />
                <Field label="Code (optional)" name="code" maxLength={40} placeholder="DS-A" />
                <TextAreaField label="Notes (optional)" name="notes" maxLength={280} />
                <SubmitButton>Create storage location</SubmitButton>
              </ActionForm>
            </article>
          ) : null}
        </section>
      )}
    </div>
  );
}
