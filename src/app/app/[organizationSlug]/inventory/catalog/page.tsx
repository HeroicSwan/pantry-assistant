import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { listCategories, listItemsWithBalances, listUnits } from "@/domains/inventory/queries";
import { createCategoryAction, createItemAction, createUnitAction } from "@/domains/inventory/actions";

export default async function CatalogPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();
  const organizationId = context.access.organization.id;
  const mayManage = can(context.effectivePermissions, "inventory.manage_catalog");

  const [units, categories, items] = await Promise.all([
    listUnits(organizationId),
    listCategories(organizationId),
    context.activeLocation ? listItemsWithBalances(organizationId, context.activeLocation.id) : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory catalog"
        title="Item catalog"
        description="Define units of measure, categories, and inventory items. Items are organization-wide; stock lives at each pantry location."
      />

      {mayManage ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <article className="border border-[var(--rule)] bg-white p-6">
            <h2 className="text-xl font-semibold">New unit</h2>
            <ActionForm action={createUnitAction.bind(null, organizationId, organizationSlug)} className="mt-4 grid gap-4">
              <Field label="Name" name="name" required maxLength={60} placeholder="Each" />
              <Field label="Abbreviation" name="abbreviation" required maxLength={16} placeholder="ea" />
              <SelectField label="Dimension" name="dimension" defaultValue="count">
                <option value="count">Count</option>
                <option value="mass">Mass</option>
                <option value="volume">Volume</option>
              </SelectField>
              <SubmitButton>Create unit</SubmitButton>
            </ActionForm>
          </article>

          <article className="border border-[var(--rule)] bg-white p-6">
            <h2 className="text-xl font-semibold">New category</h2>
            <ActionForm action={createCategoryAction.bind(null, organizationId, organizationSlug)} className="mt-4 grid gap-4">
              <Field label="Name" name="name" required maxLength={80} placeholder="Canned goods" />
              <Field label="Slug (optional)" name="slug" placeholder="canned-goods" />
              <TextAreaField label="Description (optional)" name="description" maxLength={280} />
              <SubmitButton>Create category</SubmitButton>
            </ActionForm>
          </article>

          <article className="border border-[var(--rule)] bg-white p-6">
            <h2 className="text-xl font-semibold">New item</h2>
            {units.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">Create at least one unit first.</p>
            ) : (
              <ActionForm action={createItemAction.bind(null, organizationId, organizationSlug)} className="mt-4 grid gap-4">
                <Field label="Name" name="name" required maxLength={120} placeholder="Canned black beans" />
                <Field label="SKU / PLU (optional)" name="sku" maxLength={60} />
                <SelectField label="Base unit" name="baseUnitId" required defaultValue="">
                  <option value="" disabled>Select a unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name} ({unit.abbreviation}) · {unit.dimension}</option>
                  ))}
                </SelectField>
                <SelectField label="Category (optional)" name="categoryId" defaultValue="">
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </SelectField>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="tracksExpiration" defaultChecked className="size-4" />
                  Track expiration dates
                </label>
                <SubmitButton>Create item</SubmitButton>
              </ActionForm>
            )}
          </article>
        </section>
      ) : (
        <p className="text-sm text-[var(--muted)]">You can view the catalog. Item management requires the inventory catalog permission.</p>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Units ({units.length})</h2>
          <ul className="mt-4 grid gap-2 text-sm">
            {units.map((unit) => (
              <li key={unit.id} className="flex justify-between border-b border-[var(--rule)] pb-2">
                <span className="font-semibold">{unit.name} <span className="text-[var(--muted)]">({unit.abbreviation})</span></span>
                <span className="text-[var(--muted)]">{unit.dimension}</span>
              </li>
            ))}
            {units.length === 0 ? <li className="text-[var(--muted)]">No units yet.</li> : null}
          </ul>
        </article>
        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Items ({items.length})</h2>
          <ul className="mt-4 grid gap-2 text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex justify-between border-b border-[var(--rule)] pb-2">
                <Link className="font-semibold underline" href={`/app/${organizationSlug}/inventory/items/${item.id}`}>{item.name}</Link>
                <span className="text-[var(--muted)]">{item.base_unit}{item.status === "archived" ? " · archived" : ""}</span>
              </li>
            ))}
            {items.length === 0 ? <li className="text-[var(--muted)]">No items yet.</li> : null}
          </ul>
        </article>
      </section>
    </div>
  );
}
