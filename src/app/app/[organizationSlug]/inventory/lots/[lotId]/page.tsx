import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getItem, getLot } from "@/domains/inventory/queries";
import { formatQuantity, transactionLabel } from "@/domains/inventory/format";
import { recordAdjustmentAction, reverseTransactionAction } from "@/domains/inventory/actions";

const REASON_CODES = [
  "count_correction",
  "data_entry_error",
  "undocumented_receipt",
  "undocumented_distribution",
  "damaged_found",
  "missing_inventory",
  "overage",
  "underage",
  "administrative_correction",
  "other",
];

export default async function LotDetailPage({ params }: { params: Promise<{ organizationSlug: string; lotId: string }> }) {
  const { organizationSlug, lotId } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "inventory.view")) notFound();
  const organizationId = context.access.organization.id;

  const result = await getLot(organizationId, lotId);
  if (!result) notFound();
  const { lot, transactions } = result;
  const detail = await getItem(organizationId, lot.item_id);
  const conversions = detail?.conversions ?? [];

  const mayAdjust = can(context.effectivePermissions, "inventory.adjust");
  const mayReverse = can(context.effectivePermissions, "inventory.reverse");
  const base = `/app/${organizationSlug}/inventory`;

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Inventory lot"
        title={`${lot.item_name} · ${lot.lot_code ?? lot.id.slice(0, 8)}`}
        description={`Status ${lot.status}${lot.expiration_date ? ` · expires ${lot.expiration_date}` : ""}${lot.is_expired ? " · EXPIRED" : ""}. Physical on hand is authoritative; posted transactions are immutable.`}
        actions={<Link href={`${base}/items/${lot.item_id}`} className="inline-flex min-h-11 items-center border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Back to item</Link>}
      />

      <section className="grid border-t border-l border-[var(--rule)] sm:grid-cols-3">
        {[
          ["Physical on hand", `${formatQuantity(lot.physical_on_hand)} ${lot.base_unit}`],
          ["Valid on hand", `${formatQuantity(lot.valid_on_hand)} ${lot.base_unit}`],
          ["Available", `${formatQuantity(lot.available_quantity)} ${lot.base_unit}`],
        ].map(([label, value]) => (
          <article key={label} className="border-r border-b border-[var(--rule)] bg-white p-5">
            <p className="text-sm text-[var(--muted)]">{label}</p>
            <p className="tabular mt-4 text-2xl font-semibold">{value}</p>
          </article>
        ))}
      </section>

      {mayAdjust && lot.status !== "archived" ? (
        <section className="border border-[var(--rule)] bg-white p-6">
          <h2 className="text-xl font-semibold">Record adjustment</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Posts an immutable positive or negative adjustment. Negative adjustments cannot drive the lot below zero.</p>
          <ActionForm action={recordAdjustmentAction.bind(null, organizationId, organizationSlug)} className="mt-4 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="lotId" value={lot.id} />
            <SelectField label="Direction" name="direction" defaultValue="negative">
              <option value="negative">Decrease (−)</option>
              <option value="positive">Increase (+)</option>
            </SelectField>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" name="quantity" inputMode="decimal" required placeholder="1" />
              <SelectField label="Unit" name="unitId" defaultValue={conversions.find((c) => c.isBaseUnit)?.unitId ?? ""}>
                {conversions.map((conversion) => (
                  <option key={conversion.id} value={conversion.unitId}>{conversion.abbreviation}</option>
                ))}
              </SelectField>
            </div>
            <SelectField label="Reason code" name="reasonCode" defaultValue="count_correction">
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>{code.replaceAll("_", " ")}</option>
              ))}
            </SelectField>
            <Field label="Reason" name="reason" required minLength={3} maxLength={280} placeholder="Explain this adjustment" />
            <div className="md:col-span-2">
              <SubmitButton>Post adjustment</SubmitButton>
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Transaction history <span className="tabular text-base text-[var(--muted)]">({transactions.length})</span></h2>
        <div className="overflow-x-auto border border-[var(--rule)]">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] bg-[var(--surface)] text-left">
                <th className="p-3 font-semibold">When</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="tabular p-3 text-right font-semibold">Delta ({lot.base_unit})</th>
                <th className="p-3 font-semibold">Actor</th>
                <th className="p-3 font-semibold">Reason</th>
                {mayReverse ? <th className="p-3 font-semibold">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const delta = Number(tx.physical_delta);
                const reversible = tx.transaction_type !== "reversal" && !tx.reversed_by_id;
                return (
                  <tr key={tx.id} className="border-b border-[var(--rule)] align-top last:border-b-0">
                    <td className="tabular p-3">{tx.occurred_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="p-3">
                      {transactionLabel(tx.transaction_type)}
                      {tx.reverses_transaction_id ? <span className="ml-1 text-xs text-[var(--muted)]">(reversal)</span> : null}
                      {tx.reversed_by_id ? <span className="ml-1 text-xs text-[var(--signal)]">(reversed)</span> : null}
                    </td>
                    <td className={`tabular p-3 text-right font-semibold ${delta < 0 ? "text-[var(--signal)]" : "text-[var(--success)]"}`}>
                      {delta > 0 ? "+" : ""}{formatQuantity(tx.physical_delta)}
                    </td>
                    <td className="p-3 text-[var(--muted)]">{tx.actor_name ?? "—"}</td>
                    <td className="p-3 text-[var(--muted)]">{tx.reason ?? tx.reason_code ?? "—"}</td>
                    {mayReverse ? (
                      <td className="p-3">
                        {reversible ? (
                          <details>
                            <summary className="cursor-pointer text-sm font-semibold underline">Reverse</summary>
                            <ActionForm action={reverseTransactionAction.bind(null, organizationId, organizationSlug)} className="mt-2 grid w-64 gap-2">
                              <input type="hidden" name="transactionId" value={tx.id} />
                              <TextAreaField label="Reason" name="reason" required minLength={3} maxLength={280} className="min-h-16" />
                              <SubmitButton variant="danger">Confirm reversal</SubmitButton>
                            </ActionForm>
                          </details>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
