import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { inventoryCategories, inventoryItemUnits, storageLocations, unitsOfMeasure } from "@/lib/database/schema";

export type ItemBalanceRow = {
  id: string;
  name: string;
  sku: string | null;
  status: "active" | "archived";
  base_unit: string;
  category_name: string | null;
  physical_on_hand: string;
  valid_on_hand: string;
  available_quantity: string;
  expired_quantity: string;
  quarantined_quantity: string;
  recalled_quantity: string;
  lot_count: string;
};

export async function listItemsWithBalances(
  organizationId: string,
  pantryLocationId: string,
  filters: { query?: string; stock?: "all" | "available" | "needs_review" } = {},
) {
  const query = filters.query?.trim() ?? "";
  const pattern = `%${query}%`;
  const stock = filters.stock ?? "all";
  const result = await db.execute<ItemBalanceRow>(sql`
    select
      i.id, i.name, i.sku, i.status,
      u.abbreviation as base_unit,
      c.name as category_name,
      coalesce(b.physical_on_hand, 0)::text as physical_on_hand,
      coalesce(b.valid_on_hand, 0)::text as valid_on_hand,
      coalesce(b.available_quantity, 0)::text as available_quantity,
      coalesce(b.expired_quantity, 0)::text as expired_quantity,
      coalesce(b.quarantined_quantity, 0)::text as quarantined_quantity,
      coalesce(b.recalled_quantity, 0)::text as recalled_quantity,
      coalesce(l.lot_count, 0)::text as lot_count
    from inventory_items i
    join units_of_measure u on u.id = i.base_unit_id
    left join inventory_categories c on c.id = i.category_id
    left join inventory_item_location_balances b
      on b.inventory_item_id = i.id and b.pantry_location_id = ${pantryLocationId}
    left join (
      select inventory_item_id, count(*) as lot_count
      from inventory_lots
      where pantry_location_id = ${pantryLocationId} and status <> 'archived'
      group by inventory_item_id
    ) l on l.inventory_item_id = i.id
    where i.organization_id = ${organizationId}
      and (${query} = '' or i.name ilike ${pattern} or coalesce(i.sku, '') ilike ${pattern})
      and (${stock} <> 'available' or coalesce(b.available_quantity, 0) > 0)
      and (${stock} <> 'needs_review' or coalesce(b.expired_quantity, 0) > 0 or coalesce(b.quarantined_quantity, 0) > 0 or coalesce(b.recalled_quantity, 0) > 0)
    order by i.status asc, lower(i.name) asc
  `);
  return result.rows;
}

export async function getInventorySummary(organizationId: string, pantryLocationId: string) {
  const result = await db.execute<{ items_with_stock: string; total_lots: string; expired_lots: string; storage_locations: string }>(sql`
    select
      (select count(*) from inventory_item_location_balances where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and valid_on_hand > 0)::text as items_with_stock,
      (select count(*) from inventory_lots where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and status = 'active')::text as total_lots,
      (select count(*) from inventory_lot_balances where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and is_expired and physical_on_hand > 0)::text as expired_lots,
      (select count(*) from storage_locations where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and status = 'active')::text as storage_locations
  `);
  return result.rows[0];
}

export type LotBalanceRow = {
  inventory_lot_id: string;
  lot_code: string | null;
  lot_status: "active" | "depleted" | "archived";
  received_date: string;
  expiration_date: string | null;
  physical_on_hand: string;
  valid_on_hand: string;
  available_quantity: string;
  expired_quantity: string;
  quarantined_quantity: string;
  recalled_quantity: string;
  is_expired: boolean;
  storage_location_name: string | null;
};

export async function listItemLots(organizationId: string, pantryLocationId: string, itemId: string) {
  const result = await db.execute<LotBalanceRow>(sql`
    select
      b.inventory_lot_id, b.lot_code, b.lot_status, b.received_date, b.expiration_date,
      b.physical_on_hand::text, b.valid_on_hand::text, b.available_quantity::text, b.expired_quantity::text,
      b.quarantined_quantity::text, b.recalled_quantity::text, b.is_expired,
      s.name as storage_location_name
    from inventory_lot_balances b
    left join storage_locations s on s.id = b.storage_location_id
    where b.organization_id = ${organizationId} and b.pantry_location_id = ${pantryLocationId} and b.inventory_item_id = ${itemId}
    order by (b.expiration_date is null) asc, b.expiration_date asc nulls last, b.received_date asc, b.inventory_lot_id asc
  `);
  return result.rows;
}

export async function getItem(organizationId: string, itemId: string) {
  const [item] = await db.execute<{
    id: string;
    name: string;
    sku: string | null;
    status: "active" | "archived";
    tracks_expiration: boolean;
    notes: string | null;
    base_unit_id: string;
    base_unit: string;
    category_name: string | null;
  }>(sql`
    select i.id, i.name, i.sku, i.status, i.tracks_expiration, i.notes, i.base_unit_id,
      u.abbreviation as base_unit, c.name as category_name
    from inventory_items i
    join units_of_measure u on u.id = i.base_unit_id
    left join inventory_categories c on c.id = i.category_id
    where i.id = ${itemId} and i.organization_id = ${organizationId}
    limit 1
  `).then((r) => r.rows);
  if (!item) return null;

  const conversions = await db
    .select({ id: inventoryItemUnits.id, unitId: inventoryItemUnits.unitId, abbreviation: unitsOfMeasure.abbreviation, name: unitsOfMeasure.name, factor: inventoryItemUnits.factor, roundingPolicy: inventoryItemUnits.roundingPolicy, isBaseUnit: inventoryItemUnits.isBaseUnit })
    .from(inventoryItemUnits)
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, inventoryItemUnits.unitId))
    .where(and(eq(inventoryItemUnits.organizationId, organizationId), eq(inventoryItemUnits.inventoryItemId, itemId), eq(inventoryItemUnits.isActive, true)))
    .orderBy(asc(unitsOfMeasure.name));

  return { item, conversions };
}

export type LedgerRow = {
  id: string;
  transaction_type: string;
  physical_delta: string;
  input_quantity: string | null;
  input_unit: string | null;
  reason: string | null;
  reason_code: string | null;
  reverses_transaction_id: string | null;
  reversed_by_id: string | null;
  actor_name: string | null;
  occurred_at: string;
};

export async function getLot(organizationId: string, lotId: string) {
  const [lot] = await db.execute<{
    id: string;
    lot_code: string | null;
    status: string;
    received_date: string;
    best_by_date: string | null;
    use_by_date: string | null;
    expiration_date: string | null;
    notes: string | null;
    item_id: string;
    item_name: string;
    base_unit: string;
    pantry_location_id: string;
    storage_location_name: string | null;
    physical_on_hand: string;
    valid_on_hand: string;
    available_quantity: string;
    is_expired: boolean;
  }>(sql`
    select l.id, l.lot_code, l.status, l.received_date, l.best_by_date, l.use_by_date, l.expiration_date, l.notes,
      i.id as item_id, i.name as item_name, u.abbreviation as base_unit,
      l.pantry_location_id, s.name as storage_location_name,
      coalesce(b.physical_on_hand, 0)::text as physical_on_hand,
      coalesce(b.valid_on_hand, 0)::text as valid_on_hand,
      coalesce(b.available_quantity, 0)::text as available_quantity,
      coalesce(b.is_expired, false) as is_expired
    from inventory_lots l
    join inventory_items i on i.id = l.inventory_item_id
    join units_of_measure u on u.id = i.base_unit_id
    left join storage_locations s on s.id = l.storage_location_id
    left join inventory_lot_balances b on b.inventory_lot_id = l.id
    where l.id = ${lotId} and l.organization_id = ${organizationId}
    limit 1
  `).then((r) => r.rows);
  if (!lot) return null;

  const transactions = await db.execute<LedgerRow>(sql`
    select t.id, t.transaction_type, t.physical_delta::text, t.input_quantity::text, iu.abbreviation as input_unit,
      t.reason, t.reason_code, t.reverses_transaction_id,
      rev.id as reversed_by_id,
      p.display_name as actor_name,
      t.occurred_at::text
    from inventory_transactions t
    left join units_of_measure iu on iu.id = t.input_unit_id
    left join inventory_transactions rev on rev.reverses_transaction_id = t.id
    left join user_profiles p on p.id = t.actor_user_id
    where t.inventory_lot_id = ${lotId} and t.organization_id = ${organizationId}
    order by t.occurred_at desc, t.created_at desc
  `);
  return { lot, transactions: transactions.rows };
}

export async function listActivity(organizationId: string, pantryLocationId: string, limit = 50, offset = 0) {
  const result = await db.execute<
    LedgerRow & { item_name: string; lot_code: string | null; lot_id: string }
  >(sql`
    select t.id, t.transaction_type, t.physical_delta::text, t.input_quantity::text, iu.abbreviation as input_unit,
      t.reason, t.reason_code, t.reverses_transaction_id, null::uuid as reversed_by_id,
      p.display_name as actor_name, t.occurred_at::text,
      i.name as item_name, l.lot_code, l.id as lot_id
    from inventory_transactions t
    join inventory_items i on i.id = t.inventory_item_id
    join inventory_lots l on l.id = t.inventory_lot_id
    left join units_of_measure iu on iu.id = t.input_unit_id
    left join user_profiles p on p.id = t.actor_user_id
    where t.organization_id = ${organizationId} and t.pantry_location_id = ${pantryLocationId}
    order by t.occurred_at desc, t.created_at desc
    limit ${limit} offset ${offset}
  `);
  return result.rows;
}

export async function listUnits(organizationId: string) {
  return db.select({ id: unitsOfMeasure.id, name: unitsOfMeasure.name, abbreviation: unitsOfMeasure.abbreviation, dimension: unitsOfMeasure.dimension }).from(unitsOfMeasure).where(eq(unitsOfMeasure.organizationId, organizationId)).orderBy(asc(unitsOfMeasure.name));
}

export async function listCategories(organizationId: string) {
  return db.select({ id: inventoryCategories.id, name: inventoryCategories.name, slug: inventoryCategories.slug }).from(inventoryCategories).where(and(eq(inventoryCategories.organizationId, organizationId), sql`${inventoryCategories.archivedAt} is null`)).orderBy(asc(inventoryCategories.name));
}

export async function listStorageLocations(organizationId: string, pantryLocationId: string) {
  return db
    .select({ id: storageLocations.id, name: storageLocations.name, code: storageLocations.code, status: storageLocations.status })
    .from(storageLocations)
    .where(and(eq(storageLocations.organizationId, organizationId), eq(storageLocations.pantryLocationId, pantryLocationId)))
    .orderBy(asc(storageLocations.name));
}
