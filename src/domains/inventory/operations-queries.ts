import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";

export async function listDonors(organizationId: string) {
  return (await db.execute<{ id: string; name: string; type: string; email: string | null; phone_number: string | null; status: string; donation_count: string; last_donation_date: string | null }>(sql`
    select d.id, d.name, d.donor_type as type, d.email, d.phone_number, d.status,
      count(n.id)::text as donation_count, max(n.donation_date)::text as last_donation_date
    from donors d left join donations n on n.donor_id = d.id
    where d.organization_id = ${organizationId}
    group by d.id order by d.is_anonymous_placeholder desc, d.status, lower(d.name)
  `)).rows;
}

export async function getDonor(organizationId: string, donorId: string) {
  const donor = (await db.execute<Record<string, unknown>>(sql`select * from donors where id = ${donorId} and organization_id = ${organizationId} limit 1`)).rows[0] ?? null;
  if (!donor) return null;
  const history = (await db.execute<Record<string, unknown>>(sql`select id, donation_number, status, donation_date::text, estimated_total_value::text from donations where donor_id = ${donorId} and organization_id = ${organizationId} order by donation_date desc, created_at desc`)).rows;
  return { donor, history };
}

export async function listDonations(organizationId: string, pantryLocationId: string) {
  return (await db.execute<{ id: string; donation_number: string; donor_name: string; status: string; donation_date: string; line_count: string }>(sql`
    select n.id, n.donation_number, d.name as donor_name, n.status, n.donation_date::text,
      count(l.id)::text as line_count
    from donations n join donors d on d.id = n.donor_id left join donation_lines l on l.donation_id = n.id
    where n.organization_id = ${organizationId} and n.pantry_location_id = ${pantryLocationId}
    group by n.id, d.name order by n.donation_date desc, n.created_at desc
  `)).rows;
}

export async function listReceivingSessions(organizationId: string, pantryLocationId: string) {
  return (await db.execute<{ id: string; source_type: string; status: string; started_at: string; completed_at: string | null; line_count: string; donation_number: string | null; supplier_name: string | null }>(sql`
    select s.id, s.source_type, s.status, s.started_at::text, s.completed_at::text,
      count(l.id)::text as line_count, n.donation_number, p.supplier_name
    from receiving_sessions s
    left join receiving_lines l on l.receiving_session_id = s.id
    left join donations n on n.id = s.donation_id
    left join purchased_shipments p on p.id = s.purchased_shipment_id
    where s.organization_id = ${organizationId} and s.pantry_location_id = ${pantryLocationId}
    group by s.id, n.donation_number, p.supplier_name order by s.created_at desc
  `)).rows;
}

export async function getReceivingSession(organizationId: string, sessionId: string) {
  const session = (await db.execute<Record<string, unknown>>(sql`select * from receiving_sessions where id = ${sessionId} and organization_id = ${organizationId} limit 1`)).rows[0] ?? null;
  if (!session) return null;
  const lines = (await db.execute<Record<string, unknown>>(sql`
    select l.*, i.name as item_name, u.abbreviation as entered_unit
    from receiving_lines l join inventory_items i on i.id = l.inventory_item_id join units_of_measure u on u.id = l.entered_unit_id
    where l.receiving_session_id = ${sessionId} and l.organization_id = ${organizationId} order by l.created_at
  `)).rows;
  return { session, lines };
}

export async function listAdjustmentRequests(organizationId: string, pantryLocationId: string) {
  return (await db.execute<{ id: string; status: string; risk: string; direction: string; entered_quantity: string; normalized_base_quantity: string; reason: string; item_name: string; lot_code: string | null; requester_name: string }>(sql`
    select a.id, a.status, a.risk, a.direction, a.entered_quantity::text, a.normalized_base_quantity::text,
      a.reason, i.name as item_name, l.lot_code, coalesce(p.display_name, 'Unknown') as requester_name
    from adjustment_requests a join inventory_items i on i.id = a.inventory_item_id join inventory_lots l on l.id = a.inventory_lot_id
    left join user_profiles p on p.id = a.requested_by
    where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
    order by a.created_at desc
  `)).rows;
}

export async function listConditionEvents(organizationId: string, pantryLocationId: string) {
  return (await db.execute<{ id: string; event_type: string; reason: string; created_at: string; item_name: string; lot_code: string | null; normalized_base_quantity: string | null }>(sql`
    select e.id, e.event_type, e.reason, e.created_at::text, i.name as item_name, l.lot_code, e.normalized_base_quantity::text
    from inventory_condition_events e join inventory_items i on i.id = e.inventory_item_id join inventory_lots l on l.id = e.inventory_lot_id
    where e.organization_id = ${organizationId} and e.pantry_location_id = ${pantryLocationId}
    order by e.created_at desc limit 100
  `)).rows;
}

export async function listRecalls(organizationId: string) {
  return (await db.execute<{ id: string; reference_code: string; title: string; status: string; lot_count: string }>(sql`
    select r.id, r.reference_code, r.title, r.status, count(l.inventory_lot_id)::text as lot_count
    from inventory_recalls r left join inventory_recall_lots l on l.recall_id = r.id
    where r.organization_id = ${organizationId}
    group by r.id order by r.created_at desc
  `)).rows;
}

export async function listCycleCounts(organizationId: string, pantryLocationId: string) {
  return (await db.execute<{ id: string; status: string; snapshot_at: string; entry_count: string; counted_count: string; notes: string | null }>(sql`
    select s.id, s.status, s.snapshot_at::text, s.notes, count(e.id)::text as entry_count,
      count(e.id) filter (where e.normalized_counted_quantity is not null)::text as counted_count
    from cycle_count_sessions s left join cycle_count_entries e on e.count_session_id = s.id
    where s.organization_id = ${organizationId} and s.pantry_location_id = ${pantryLocationId}
    group by s.id order by s.created_at desc
  `)).rows;
}

export async function getCycleCount(organizationId: string, sessionId: string) {
  const session = (await db.execute<Record<string, unknown>>(sql`select * from cycle_count_sessions where id = ${sessionId} and organization_id = ${organizationId} limit 1`)).rows[0] ?? null;
  if (!session) return null;
  const entries = (await db.execute<Record<string, unknown>>(sql`
    select e.*, i.name as item_name, l.lot_code, u.id as base_unit_id, u.abbreviation as base_unit
    from cycle_count_entries e join inventory_items i on i.id = e.inventory_item_id join inventory_lots l on l.id = e.inventory_lot_id join units_of_measure u on u.id = i.base_unit_id
    where e.count_session_id = ${sessionId} and e.organization_id = ${organizationId} order by lower(i.name), l.expiration_date nulls last
  `)).rows;
  return { session, entries };
}

export async function listTransfers(organizationId: string, locationId: string) {
  return (await db.execute<{ id: string; transfer_number: string; status: string; source_name: string; destination_name: string; line_count: string; in_transit_quantity: string }>(sql`
    select t.id, t.transfer_number, t.status, s.name as source_name, d.name as destination_name,
      count(l.id)::text as line_count, coalesce(sum(greatest(l.dispatched_base_quantity - l.received_base_quantity, 0)),0)::text as in_transit_quantity
    from inventory_transfers t join pantry_locations s on s.id = t.source_location_id join pantry_locations d on d.id = t.destination_location_id
    left join inventory_transfer_lines l on l.transfer_id = t.id
    where t.organization_id = ${organizationId} and (${locationId} in (t.source_location_id, t.destination_location_id))
    group by t.id, s.name, d.name order by t.created_at desc
  `)).rows;
}

export async function getTransfer(organizationId: string, transferId: string) {
  const transfer = (await db.execute<Record<string, unknown>>(sql`
    select t.*, s.name as source_name, d.name as destination_name from inventory_transfers t
    join pantry_locations s on s.id = t.source_location_id join pantry_locations d on d.id = t.destination_location_id
    where t.id = ${transferId} and t.organization_id = ${organizationId} limit 1
  `)).rows[0] ?? null;
  if (!transfer) return null;
  const lines = (await db.execute<Record<string, unknown>>(sql`
    select l.*, i.name as item_name, lot.lot_code, u.abbreviation as requested_unit,
      greatest(l.dispatched_base_quantity-l.received_base_quantity,0)::text as in_transit_quantity
    from inventory_transfer_lines l join inventory_items i on i.id = l.inventory_item_id join inventory_lots lot on lot.id = l.source_lot_id join units_of_measure u on u.id = l.requested_unit_id
    where l.transfer_id = ${transferId} and l.organization_id = ${organizationId} order by l.created_at
  `)).rows;
  return { transfer, lines };
}

export async function listOperationalChoices(organizationId: string, pantryLocationId: string) {
  const lots = (await db.execute<{ id: string; item_id: string; item_name: string; lot_code: string | null; available_quantity: string; base_unit_id: string; base_unit: string }>(sql`
    select b.inventory_lot_id as id, i.id as item_id, i.name as item_name, b.lot_code, b.available_quantity::text,
      u.id as base_unit_id, u.abbreviation as base_unit
    from inventory_lot_balances b join inventory_items i on i.id = b.inventory_item_id join units_of_measure u on u.id = i.base_unit_id
    where b.organization_id = ${organizationId} and b.pantry_location_id = ${pantryLocationId} and b.lot_status <> 'archived'
    order by lower(i.name), b.expiration_date nulls last
  `)).rows;
  const items = (await db.execute<{ id: string; name: string; base_unit_id: string; base_unit: string }>(sql`
    select i.id, i.name, u.id as base_unit_id, u.abbreviation as base_unit from inventory_items i join units_of_measure u on u.id = i.base_unit_id
    where i.organization_id = ${organizationId} and i.status = 'active' order by lower(i.name)
  `)).rows;
  const locations = (await db.execute<{ id: string; name: string }>(sql`select id, name from pantry_locations where organization_id = ${organizationId} and status = 'active' order by lower(name)`)).rows;
  const donations = (await db.execute<{ id: string; donation_number: string }>(sql`select id, donation_number from donations where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and status in ('draft','expected','receiving') order by created_at desc`)).rows;
  const purchases = (await db.execute<{ id: string; supplier_name: string; supplier_reference: string | null }>(sql`select id, supplier_name, supplier_reference from purchased_shipments where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId} and status in ('draft','ordered','partially_received') order by created_at desc`)).rows;
  return { lots, items, locations, donations, purchases };
}
