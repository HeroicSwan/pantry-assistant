import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { BarcodeLabelPrinter } from "@/components/inventory/barcode-label-printer";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import {
  getItem,
  listItemLots,
  listStorageLocations,
  listUnits,
} from "@/domains/inventory/queries";
import { formatQuantity } from "@/domains/inventory/format";
import {
  addItemUnitAction,
  createLotAction,
} from "@/domains/inventory/actions";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; itemId: string }>;
}) {
  const { organizationSlug, itemId } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();
  const organizationId = context.access.organization.id;

  const detail = await getItem(organizationId, itemId);
  if (!detail) notFound();
  const { item, conversions } = detail;

  const location = context.activeLocation;
  const [lots, storage, units] = await Promise.all([
    location
      ? listItemLots(organizationId, location.id, itemId)
      : Promise.resolve([]),
    location
      ? listStorageLocations(organizationId, location.id)
      : Promise.resolve([]),
    listUnits(organizationId),
  ]);
  const mayManage = can(
    context.effectivePermissions,
    "inventory.manage_catalog",
  );
  const mayReceive = can(context.effectivePermissions, "inventory.receive");
  const today = new Date().toISOString().slice(0, 10);
  const base = `/app/${organizationSlug}/inventory`;

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory item"
        title={item.name}
        description={`Base unit ${item.base_unit}${item.category_name ? ` · ${item.category_name}` : ""}${item.tracks_expiration ? " · tracks expiration" : ""}${item.status === "archived" ? " · archived" : ""}`}
        actions={
          <Link
            href={`${base}/catalog`}
            className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold"
          >
            Back to catalog
          </Link>
        }
      />

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">
          Lots {location ? `at ${location.name}` : ""}{" "}
          <span className="tabular text-base text-[var(--muted)]">
            ({lots.length})
          </span>
        </h2>
        {!location ? (
          <p className="text-sm text-[var(--muted)]">
            Select an active pantry location to view and receive lots.
          </p>
        ) : lots.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No lots at this location yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-[var(--rule)]">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">
                  <th className="p-3 font-semibold">Lot</th>
                  <th className="p-3 font-semibold">Storage</th>
                  <th className="p-3 font-semibold">Received</th>
                  <th className="p-3 font-semibold">Expires</th>
                  <th className="tabular p-3 text-right font-semibold">
                    On hand
                  </th>
                  <th className="tabular p-3 text-right font-semibold">
                    Available
                  </th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr
                    key={lot.inventory_lot_id}
                    className="border-b border-[var(--rule)] last:border-b-0"
                  >
                    <td className="p-3">
                      <Link
                        className="font-semibold underline"
                        href={`${base}/lots/${lot.inventory_lot_id}`}
                      >
                        {lot.lot_code ?? lot.inventory_lot_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="p-3 text-[var(--muted)]">
                      {lot.storage_location_name ?? "—"}
                    </td>
                    <td className="tabular p-3">{lot.received_date}</td>
                    <td className="tabular p-3">
                      {lot.expiration_date ?? "—"}
                      {lot.is_expired ? (
                        <span className="ml-2 text-xs font-semibold text-[var(--signal)]">
                          expired
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular p-3 text-right">
                      {formatQuantity(lot.physical_on_hand)} {item.base_unit}
                    </td>
                    <td className="tabular p-3 text-right font-semibold">
                      {formatQuantity(lot.available_quantity)}
                    </td>
                    <td className="p-3 text-[var(--muted)]">
                      {lot.lot_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border border-[var(--rule)] bg-white p-6">
        <h2 className="text-xl font-semibold">Scanner labels</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Print Code 128 labels for this item&apos;s SKU / PLU. USB scanners and
          the camera lookup both return staff to this catalog item.
        </p>
        <BarcodeLabelPrinter itemName={item.name} sku={item.sku} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {mayReceive && location && item.status === "active" ? (
          <article className="border border-[var(--rule)] bg-white p-6">
            <h2 className="text-xl font-semibold">Create lot</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Optionally record an opening balance. Opening balances post an
              immutable <code>opening_balance</code> transaction.
            </p>
            <ActionForm
              action={createLotAction.bind(
                null,
                organizationId,
                organizationSlug,
                location.id,
              )}
              className="mt-4 grid gap-4"
            >
              <input type="hidden" name="itemId" value={itemId} />
              <Field
                label="Lot code (optional)"
                name="lotCode"
                maxLength={80}
                placeholder="LOT-2026-07"
              />
              <SelectField
                label="Storage location (optional)"
                name="storageLocationId"
                defaultValue=""
              >
                <option value="">Unassigned</option>
                {storage
                  .filter((s) => s.status === "active")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </SelectField>
              <Field
                label="Received date"
                name="receivedDate"
                type="date"
                defaultValue={today}
                required
              />
              <Field
                label="Expiration date (optional)"
                name="expirationDate"
                type="date"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Opening quantity (optional)"
                  name="openingQuantity"
                  inputMode="decimal"
                  placeholder="0"
                />
                <SelectField
                  label="Unit"
                  name="openingUnitId"
                  defaultValue={item.base_unit_id}
                >
                  {conversions.map((conversion) => (
                    <option key={conversion.id} value={conversion.unitId}>
                      {conversion.abbreviation}
                    </option>
                  ))}
                </SelectField>
              </div>
              <TextAreaField
                label="Notes (optional)"
                name="notes"
                maxLength={280}
              />
              <SubmitButton>Create lot</SubmitButton>
            </ActionForm>
          </article>
        ) : null}

        <article className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Unit conversions</h2>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-left">
                <th className="py-2 font-semibold">Unit</th>
                <th className="tabular py-2 text-right font-semibold">
                  Factor → {item.base_unit}
                </th>
                <th className="py-2 text-right font-semibold">Rounding</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map((conversion) => (
                <tr
                  key={conversion.id}
                  className="border-b border-[var(--rule)]"
                >
                  <td className="py-2">
                    {conversion.name} ({conversion.abbreviation})
                    {conversion.isBaseUnit ? " · base" : ""}
                  </td>
                  <td className="tabular py-2 text-right">
                    {formatQuantity(conversion.factor)}
                  </td>
                  <td className="py-2 text-right text-[var(--muted)]">
                    {conversion.roundingPolicy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mayManage ? (
            <ActionForm
              action={addItemUnitAction.bind(
                null,
                organizationId,
                organizationSlug,
              )}
              className="mt-6 grid gap-4 border-t border-[var(--rule)] pt-6"
            >
              <input type="hidden" name="itemId" value={itemId} />
              <SelectField label="Unit" name="unitId" required defaultValue="">
                <option value="" disabled>
                  Select a unit
                </option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.abbreviation})
                  </option>
                ))}
              </SelectField>
              <Field
                label={`Factor (1 unit = ? ${item.base_unit})`}
                name="factor"
                inputMode="decimal"
                required
                placeholder="24"
              />
              <SelectField
                label="Rounding policy"
                name="roundingPolicy"
                defaultValue="reject"
              >
                <option value="reject">Reject inexact</option>
                <option value="floor">Floor</option>
                <option value="ceiling">Ceiling</option>
                <option value="half_up">Half up</option>
              </SelectField>
              <SubmitButton>Add conversion</SubmitButton>
            </ActionForm>
          ) : null}
        </article>
      </section>
    </div>
  );
}
