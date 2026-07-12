import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { reportDefinitions, type ReportFilters, type ReportType, weeklyRecommendations } from "@/domains/reports/policy";

export type ReportScope = {
  organizationId: string;
  locationId: string;
  timezone: string;
};

export type ReportData = {
  reportType: ReportType;
  title: string;
  description: string;
  columns: typeof reportDefinitions[ReportType]["columns"];
  rows: Record<string, unknown>[];
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
  hasNext: boolean;
  generatedAt: string;
};

type LoadOptions = { maxRows?: number; offset?: number };

const empty = sql``;

function dateRange(column: SQL, scope: ReportScope, filters: ReportFilters) {
  return sql`(${column} at time zone ${scope.timezone})::date between ${filters.dateFrom}::date and ${filters.dateTo}::date`;
}

async function bounded(query: SQL, maxRows: number, offset: number) {
  const result = await db.execute<Record<string, unknown>>(sql`${query} limit ${maxRows + 1} offset ${offset}`);
  return { rows: result.rows.slice(0, maxRows), hasNext: result.rows.length > maxRows };
}

function itemFilter(filters: ReportFilters, alias: SQL = sql`i.id`) {
  return filters.itemId ? sql`and ${alias} = ${filters.itemId}::uuid` : empty;
}

function categoryFilter(filters: ReportFilters, alias: SQL = sql`i.category_id`) {
  return filters.categoryId ? sql`and ${alias} = ${filters.categoryId}::uuid` : empty;
}

async function inventoryOnHand(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  return bounded(sql`
    select coalesce(c.name, 'Uncategorized') as category, i.name as item, coalesce(i.sku, '') as sku,
      b.physical_on_hand::text, b.valid_on_hand::text, b.reserved_quantity::text, b.available_quantity::text,
      b.quarantined_quantity::text, b.recalled_quantity::text, b.expired_quantity::text, u.abbreviation as unit
    from inventory_item_location_balances b
    join inventory_items i on i.id = b.inventory_item_id and i.organization_id = b.organization_id
    join units_of_measure u on u.id = i.base_unit_id
    left join inventory_categories c on c.id = i.category_id
    where b.organization_id = ${scope.organizationId}::uuid and b.pantry_location_id = ${scope.locationId}::uuid
      ${itemFilter(filters)} ${categoryFilter(filters)}
    order by lower(coalesce(c.name, '')), lower(i.name)
  `, maxRows, offset);
}

async function expiringInventory(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  return bounded(sql`
    select i.name as item, coalesce(b.lot_code, 'Unlabeled') as lot, coalesce(s.name, 'Unassigned') as storage,
      coalesce(b.expiration_date::text, 'Missing') as expiration_date,
      case when b.expiration_date is null then null else b.expiration_date - (${filters.dateTo}::date) end as days_remaining,
      b.physical_on_hand::text, b.available_quantity::text, u.abbreviation as unit,
      case when b.is_expired then 'expired' when b.quarantined_quantity > 0 then 'quarantined'
           when b.recalled_quantity > 0 then 'recalled' when b.expiration_date is null then 'missing date' else 'expiring' end as condition
    from inventory_lot_balances b
    join inventory_items i on i.id = b.inventory_item_id
    join units_of_measure u on u.id = i.base_unit_id
    left join storage_locations s on s.id = b.storage_location_id
    where b.organization_id = ${scope.organizationId}::uuid and b.pantry_location_id = ${scope.locationId}::uuid
      and b.physical_on_hand > 0 and (b.expiration_date is null or b.expiration_date <= ${filters.dateTo}::date)
      ${itemFilter(filters)} ${categoryFilter(filters)}
    order by b.expiration_date nulls first, lower(i.name), b.received_date
  `, maxRows, offset);
}

async function inventoryQuality(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const eventFilter = filters.transactionType ? sql`and e.event_type = ${filters.transactionType}` : empty;
  return bounded(sql`
    select to_char(e.created_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as event_date,
      replace(e.event_type::text, '_', ' ') as event_type, i.name as item, coalesce(l.lot_code, 'Unlabeled') as lot,
      coalesce(e.normalized_base_quantity, 0)::text as quantity, u.abbreviation as unit, e.reason
    from inventory_condition_events e
    join inventory_items i on i.id = e.inventory_item_id
    join inventory_lots l on l.id = e.inventory_lot_id
    join units_of_measure u on u.id = i.base_unit_id
    where e.organization_id = ${scope.organizationId}::uuid and e.pantry_location_id = ${scope.locationId}::uuid
      and ${dateRange(sql`e.created_at`, scope, filters)} ${itemFilter(filters)} ${categoryFilter(filters)} ${eventFilter}
    order by e.created_at desc, e.id
  `, maxRows, offset);
}

async function inventoryTransactions(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const typeFilter = filters.transactionType ? sql`and t.transaction_type::text = ${filters.transactionType}` : empty;
  return bounded(sql`
    select to_char(t.occurred_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as occurred_at,
      i.name as item, coalesce(l.lot_code, 'Unlabeled') as lot, replace(t.transaction_type::text, '_', ' ') as transaction_type,
      t.physical_delta::text, u.abbreviation as unit, coalesce(t.reason, t.reason_code, '') as reason
    from inventory_transactions t
    join inventory_items i on i.id = t.inventory_item_id
    join inventory_lots l on l.id = t.inventory_lot_id
    join units_of_measure u on u.id = i.base_unit_id
    where t.organization_id = ${scope.organizationId}::uuid and t.pantry_location_id = ${scope.locationId}::uuid
      and ${dateRange(sql`t.occurred_at`, scope, filters)} ${itemFilter(filters)} ${categoryFilter(filters)} ${typeFilter}
    order by t.occurred_at desc, t.created_at desc
  `, maxRows, offset);
}

async function donations(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const donorFilter = filters.donorId ? sql`and n.donor_id = ${filters.donorId}::uuid` : empty;
  return bounded(sql`
    select n.donation_date::text, n.donation_number, d.name as donor, n.status::text,
      (select count(*) from donation_lines dl where dl.donation_id=n.id)::text as line_count,
      coalesce(received.quantity, 0)::text as received_quantity,
      coalesce(n.estimated_total_value, 0)::text as estimated_value
    from donations n
    join donors d on d.id = n.donor_id
    left join lateral (
      select sum(rl.normalized_base_quantity) as quantity
      from receiving_sessions rs join receiving_lines rl on rl.receiving_session_id=rs.id
      where rs.donation_id=n.id and rs.status='completed' and rl.line_status='completed'
    ) received on true
    where n.organization_id = ${scope.organizationId}::uuid and n.pantry_location_id = ${scope.locationId}::uuid
      and n.donation_date between ${filters.dateFrom}::date and ${filters.dateTo}::date ${donorFilter}
    order by n.donation_date desc, n.created_at desc
  `, maxRows, offset);
}

async function donorContributions(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const donorFilter = filters.donorId ? sql`and d.id = ${filters.donorId}::uuid` : empty;
  return bounded(sql`
    with donation_totals as (
      select n.donor_id, count(*) as donation_count, count(*) filter(where n.status='completed') as completed_donations,
        coalesce(sum(n.estimated_total_value),0) as estimated_value, max(n.donation_date) as last_donation_date
      from donations n
      where n.organization_id=${scope.organizationId}::uuid and n.pantry_location_id=${scope.locationId}::uuid
        and n.donation_date between ${filters.dateFrom}::date and ${filters.dateTo}::date
      group by n.donor_id
    ), received_totals as (
      select n.donor_id, coalesce(sum(rl.normalized_base_quantity),0) as received_quantity
      from donations n join receiving_sessions rs on rs.donation_id=n.id and rs.status='completed'
      join receiving_lines rl on rl.receiving_session_id=rs.id and rl.line_status='completed'
      where n.organization_id=${scope.organizationId}::uuid and n.pantry_location_id=${scope.locationId}::uuid
        and n.donation_date between ${filters.dateFrom}::date and ${filters.dateTo}::date
      group by n.donor_id
    )
    select d.name as donor, replace(d.donor_type::text, '_', ' ') as donor_type,
      totals.donation_count::text, totals.completed_donations::text,
      coalesce(received.received_quantity,0)::text, totals.estimated_value::text,
      totals.last_donation_date::text
    from donation_totals totals join donors d on d.id=totals.donor_id
    left join received_totals received on received.donor_id=totals.donor_id
    where d.organization_id = ${scope.organizationId}::uuid ${donorFilter}
    order by totals.estimated_value desc, lower(d.name)
  `, maxRows, offset);
}

async function receiving(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  return bounded(sql`
    select to_char(rs.started_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as started_at,
      replace(rs.source_type::text, '_', ' ') as source_type,
      coalesce(n.donation_number, p.supplier_reference, p.supplier_name, 'Other') as reference,
      rs.status::text, count(rl.id)::text as line_count,
      coalesce(sum(rl.normalized_base_quantity) filter (where rl.line_status = 'completed'), 0)::text as received_quantity,
      coalesce(to_char(rs.completed_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI'), '') as completed_at
    from receiving_sessions rs
    left join receiving_lines rl on rl.receiving_session_id = rs.id
    left join donations n on n.id = rs.donation_id
    left join purchased_shipments p on p.id = rs.purchased_shipment_id
    where rs.organization_id = ${scope.organizationId}::uuid and rs.pantry_location_id = ${scope.locationId}::uuid
      and ${dateRange(sql`rs.started_at`, scope, filters)}
    group by rs.id, n.donation_number, p.supplier_reference, p.supplier_name
    order by rs.started_at desc
  `, maxRows, offset);
}

async function distributions(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const statusFilter = filters.appointmentStatus ? sql`and a.status::text = ${filters.appointmentStatus}` : empty;
  const householdFilter = filters.householdId ? sql`and a.household_id = ${filters.householdId}::uuid` : empty;
  return bounded(sql`
    select (coalesce(a.completed_at, a.no_show_at, a.cancelled_at, a.scheduled_start_at) at time zone ${scope.timezone})::date::text as service_date,
      a.appointment_number, h.household_number, a.household_size_snapshot::text as household_size,
      replace(a.status::text, '_', ' ') as status, coalesce(pt.name, '') as package,
      count(fl.id)::text as item_lines,
      coalesce(sum(fl.fulfilled_base_quantity) filter (where pf.status <> 'corrected'), 0)::text as distributed_quantity
    from appointments a
    join households h on h.id = a.household_id and h.organization_id = a.organization_id
    left join pickup_package_templates pt on pt.id = a.package_template_id
    left join pickup_fulfillments pf on pf.appointment_id = a.id
    left join pickup_fulfillment_lines fl on fl.pickup_fulfillment_id = pf.id
    where a.organization_id = ${scope.organizationId}::uuid and a.pantry_location_id = ${scope.locationId}::uuid
      and ${dateRange(sql`coalesce(a.completed_at, a.no_show_at, a.cancelled_at, a.scheduled_start_at)`, scope, filters)}
      ${statusFilter} ${householdFilter}
    group by a.id, h.household_number, pt.name
    order by coalesce(a.completed_at, a.no_show_at, a.cancelled_at, a.scheduled_start_at) desc
  `, maxRows, offset);
}

async function pickupSchedule(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const statusFilter = filters.appointmentStatus ? sql`and a.status::text = ${filters.appointmentStatus}` : empty;
  return bounded(sql`
    select to_char(a.scheduled_start_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as scheduled_start,
      to_char(a.scheduled_end_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as scheduled_end,
      a.appointment_number, h.household_number, a.household_size_snapshot::text as household_size,
      replace(a.appointment_type::text, '_', ' ') as appointment_type, coalesce(pt.name, '') as package,
      coalesce(r.status::text, 'none') as reservation_status, replace(a.status::text, '_', ' ') as status
    from appointments a
    join households h on h.id = a.household_id and h.organization_id = a.organization_id
    left join pickup_package_templates pt on pt.id = a.package_template_id
    left join lateral (
      select ir.status from inventory_reservations ir where ir.appointment_id = a.id order by ir.created_at desc limit 1
    ) r on true
    where a.organization_id = ${scope.organizationId}::uuid and a.pantry_location_id = ${scope.locationId}::uuid
      and ${dateRange(sql`a.scheduled_start_at`, scope, filters)} ${statusFilter}
    order by a.scheduled_start_at, a.appointment_number
  `, maxRows, offset);
}

async function forecasts(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const confidenceFilter = filters.forecastConfidence ? sql`and r.confidence_level::text = ${filters.forecastConfidence}` : empty;
  return bounded(sql`
    with latest as (
      select id, generated_at from forecast_snapshots
      where organization_id = ${scope.organizationId}::uuid and pantry_location_id = ${scope.locationId}::uuid and status = 'completed'
      order by generated_at desc limit 1
    )
    select to_char(s.generated_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as generated_at,
      coalesce(c.name, 'Uncategorized') as category, i.name as item, r.available_quantity::text,
      coalesce(r.weighted_daily_demand, 0)::text as daily_demand, r.confirmed_incoming::text,
      coalesce(r.projected_shortage_date::text, '') as shortage_date, r.recommended_quantity::text,
      u.abbreviation as unit, concat(r.confidence_score, '/100 ', replace(r.confidence_level::text, '_', ' ')) as confidence,
      r.risk_level::text as risk
    from latest s
    join forecast_item_results r on r.snapshot_id = s.id
    join inventory_items i on i.id = r.inventory_item_id
    join units_of_measure u on u.id = i.base_unit_id
    left join inventory_categories c on c.id = i.category_id
    where true ${itemFilter(filters)} ${categoryFilter(filters)} ${confidenceFilter}
    order by case r.risk_level when 'urgent' then 1 when 'shortage' then 2 when 'watch' then 3 else 4 end, lower(i.name)
  `, maxRows, offset);
}

async function messaging(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const statusFilter = filters.messageStatus ? sql`and m.status = ${filters.messageStatus}` : empty;
  return bounded(sql`
    with outbound as (
      select (m.created_at at time zone ${scope.timezone})::date as day,
        count(*) filter (where m.status in ('accepted','sending','sent','delivered','undelivered','failed')) as sent,
        count(*) filter (where m.status = 'delivered') as delivered,
        count(*) filter (where m.status in ('failed','undelivered')) as failed
      from sms_messages m
      where m.organization_id = ${scope.organizationId}::uuid and m.pantry_location_id = ${scope.locationId}::uuid
        and ${dateRange(sql`m.created_at`, scope, filters)} ${statusFilter}
      group by 1
    ), inbound as (
      select (m.received_at at time zone ${scope.timezone})::date as day,
        count(*) filter (where m.normalized_command = 'STOP') as opt_outs,
        count(*) filter (where m.normalized_command in ('YES','Y','CONFIRM')) as confirmations
      from inbound_messages m
      where m.organization_id = ${scope.organizationId}::uuid and m.pantry_location_id = ${scope.locationId}::uuid
        and ${dateRange(sql`m.received_at`, scope, filters)}
      group by 1
    ), days as (select day from outbound union select day from inbound)
    select d.day::text, coalesce(o.sent, 0)::text as messages_sent, coalesce(o.delivered, 0)::text as delivered,
      coalesce(o.failed, 0)::text as failed,
      case when coalesce(o.sent, 0) = 0 then '—' else round(o.delivered::numeric * 100 / o.sent, 1)::text || '%' end as delivery_rate,
      coalesce(i.opt_outs, 0)::text as opt_outs, coalesce(i.confirmations, 0)::text as confirmations
    from days d left join outbound o using(day) left join inbound i using(day)
    order by d.day desc
  `, maxRows, offset);
}

type WeeklyRaw = {
  households_served: string; completed_pickups: string; partial_pickups: string; no_shows: string;
  received_quantity: string; distributed_quantity: string; spoilage: string; damage: string; expiration_removal: string;
  transfers: string; incoming_quantity: string; urgent_shortages: string; category_gaps: string; urgent_alerts: string;
  reminders_sent: string; delivered_messages: string; failed_messages: string; expiring_quantity: string;
};

async function weeklySummary(scope: ReportScope, filters: ReportFilters) {
  const [row] = await db.execute<WeeklyRaw>(sql`
    select
      (select count(distinct household_id) from appointments where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status in ('completed','partially_completed') and ${dateRange(sql`completed_at`, scope, filters)})::text households_served,
      (select count(*) from appointments where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='completed' and ${dateRange(sql`completed_at`, scope, filters)})::text completed_pickups,
      (select count(*) from appointments where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='partially_completed' and ${dateRange(sql`completed_at`, scope, filters)})::text partial_pickups,
      (select count(*) from appointments where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='no_show' and ${dateRange(sql`no_show_at`, scope, filters)})::text no_shows,
      (select coalesce(sum(physical_delta),0) from inventory_transactions where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and transaction_type in ('donation_received','purchase_received','transfer_in') and ${dateRange(sql`occurred_at`, scope, filters)})::text received_quantity,
      (select coalesce(sum(case when t.transaction_type='pickup_fulfillment' then -t.physical_delta when original.transaction_type='pickup_fulfillment' then -t.physical_delta else 0 end),0) from inventory_transactions t left join inventory_transactions original on original.id=t.reverses_transaction_id where t.organization_id=${scope.organizationId}::uuid and t.pantry_location_id=${scope.locationId}::uuid and ${dateRange(sql`t.occurred_at`, scope, filters)})::text distributed_quantity,
      (select coalesce(-sum(physical_delta),0) from inventory_transactions where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and transaction_type='spoilage' and ${dateRange(sql`occurred_at`, scope, filters)})::text spoilage,
      (select coalesce(-sum(physical_delta),0) from inventory_transactions where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and transaction_type='damage' and ${dateRange(sql`occurred_at`, scope, filters)})::text damage,
      (select coalesce(-sum(physical_delta),0) from inventory_transactions where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and transaction_type='expiration' and ${dateRange(sql`occurred_at`, scope, filters)})::text expiration_removal,
      (select count(*) from inventory_transfers where organization_id=${scope.organizationId}::uuid and ${scope.locationId}::uuid in (source_location_id,destination_location_id) and ${dateRange(sql`created_at`, scope, filters)})::text transfers,
      (select coalesce(sum(incoming.quantity),0) from (
        select dl.expected_quantity*iu.factor as quantity from donations d join donation_lines dl on dl.donation_id=d.id
          join inventory_item_units iu on iu.inventory_item_id=dl.inventory_item_id and iu.unit_id=dl.expected_unit_id and iu.is_active
          where d.organization_id=${scope.organizationId}::uuid and d.pantry_location_id=${scope.locationId}::uuid and d.status='receiving'
        union all
        select greatest(tl.dispatched_base_quantity-tl.received_base_quantity,0) from inventory_transfers t
          join inventory_transfer_lines tl on tl.transfer_id=t.id where t.organization_id=${scope.organizationId}::uuid
          and t.destination_location_id=${scope.locationId}::uuid and t.status in('dispatched','partially_received')
      ) incoming)::text incoming_quantity,
      (select count(*) from forecast_item_results where snapshot_id=(select id from forecast_snapshots where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='completed' order by generated_at desc limit 1) and risk_level='urgent')::text urgent_shortages,
      (select count(*) from forecast_category_results where snapshot_id=(select id from forecast_snapshots where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='completed' order by generated_at desc limit 1) and risk_level in ('urgent','shortage'))::text category_gaps,
      (select count(*) from operational_alerts where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status in ('open','acknowledged') and severity='critical')::text urgent_alerts,
      (select count(*) from sms_messages where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and message_type='appointment_reminder' and status in ('accepted','sending','sent','delivered','undelivered','failed') and ${dateRange(sql`created_at`, scope, filters)})::text reminders_sent,
      (select count(*) from sms_messages where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status='delivered' and ${dateRange(sql`created_at`, scope, filters)})::text delivered_messages,
      (select count(*) from sms_messages where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and status in ('failed','undelivered') and ${dateRange(sql`created_at`, scope, filters)})::text failed_messages,
      (select coalesce(sum(physical_on_hand),0) from inventory_lot_balances where organization_id=${scope.organizationId}::uuid and pantry_location_id=${scope.locationId}::uuid and physical_on_hand>0 and expiration_date between ${filters.dateFrom}::date and ${filters.dateTo}::date)::text expiring_quantity
  `).then((result) => result.rows);
  const metrics = row ?? {
    households_served: "0", completed_pickups: "0", partial_pickups: "0", no_shows: "0", received_quantity: "0",
    distributed_quantity: "0", spoilage: "0", damage: "0", expiration_removal: "0", transfers: "0", incoming_quantity: "0",
    urgent_shortages: "0", category_gaps: "0", urgent_alerts: "0", reminders_sent: "0", delivered_messages: "0", failed_messages: "0", expiring_quantity: "0",
  };
  const deliveryDenominator = Number(metrics.delivered_messages) + Number(metrics.failed_messages);
  const rows: Record<string, unknown>[] = [
    ["Households served", metrics.households_served, "households", "Distinct households with completed or partial pickups."],
    ["Completed pickups", metrics.completed_pickups, "pickups", "Appointments completed in full."],
    ["Partial pickups", metrics.partial_pickups, "pickups", "Appointments completed with partial fulfillment."],
    ["No-shows", metrics.no_shows, "appointments", "Appointments marked no-show."],
    ["Inventory received", metrics.received_quantity, "base units", "Donation, purchase, other receipt, and transfer-in ledger quantity."],
    ["Inventory distributed", metrics.distributed_quantity, "base units", "Net pickup-fulfillment ledger quantity, including reversals."],
    ["Spoilage", metrics.spoilage, "base units", "Net spoilage removals."],
    ["Damage", metrics.damage, "base units", "Net damage removals."],
    ["Expiration removal", metrics.expiration_removal, "base units", "Net expiration removals."],
    ["Transfers", metrics.transfers, "transfers", "Transfers created that touch this location."],
    ["Confirmed incoming", metrics.incoming_quantity, "base units", "Expected donation-line quantities."],
    ["Urgent shortages", metrics.urgent_shortages, "items", "Urgent items in the latest successful forecast."],
    ["Category gaps", metrics.category_gaps, "categories", "Shortage or urgent categories in the latest forecast."],
    ["Open urgent alerts", metrics.urgent_alerts, "alerts", "Open or acknowledged critical alerts."],
    ["SMS reminders sent", metrics.reminders_sent, "messages", "Appointment reminders accepted by the provider or completed."],
    ["Delivery rate", deliveryDenominator > 0 ? `${(Number(metrics.delivered_messages) * 100 / deliveryDenominator).toFixed(1)}%` : "—", "delivered / final", "Delivered versus delivered, failed, and undelivered final states."],
    ["Failed messages", metrics.failed_messages, "messages", "Failed or undelivered outbound messages."],
  ].map(([metric, value, unit, note]) => ({ metric, value, unit, note }));
  weeklyRecommendations({ urgentAlerts: Number(metrics.urgent_alerts), noShows: Number(metrics.no_shows), failedMessages: Number(metrics.failed_messages), expiringQuantity: Number(metrics.expiring_quantity) })
    .forEach((note, index) => rows.push({ metric: `Recommended action ${index + 1}`, value: "Review", unit: "action", note }));
  return { rows, hasNext: false };
}

async function donationNeeds(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  return bounded(sql`
    with latest as (
      select dns.*, fs.horizon_end
      from donation_need_snapshots dns join forecast_snapshots fs on fs.id=dns.forecast_snapshot_id
      where dns.organization_id=${scope.organizationId}::uuid and dns.pantry_location_id=${scope.locationId}::uuid
      order by dns.generated_at desc limit 1
    ), recommendation as (
      select latest.forecast_snapshot_id, latest.horizon_end, value
      from latest cross join lateral jsonb_array_elements(latest.recommendations) value
    )
    select case value->>'risk' when 'urgent' then '1 - urgent' when 'shortage' then '2 - shortage' when 'watch' then '3 - watch' else '4 - monitor' end as priority,
      i.name as item, r.available_quantity::text as available_supply,
      (coalesce(r.weighted_daily_demand,0) * greatest(rec.horizon_end - fs.as_of::date, 1) + r.scheduled_unreserved)::text as projected_demand,
      r.confirmed_incoming::text, coalesce(r.projected_shortage_date::text, '') as shortage_date,
      coalesce(value->>'neededBy', '') as needed_by, r.recommended_quantity::text as recommended_amount,
      u.abbreviation as unit, concat(r.confidence_score, '/100 ', replace(r.confidence_level::text, '_', ' ')) as confidence,
      concat('Deterministic ', replace(r.risk_level::text, '_', ' '), ' risk; recommendation includes demand, incoming supply, safety stock, and expiration projection.') as explanation
    from recommendation rec
    join forecast_snapshots fs on fs.id=rec.forecast_snapshot_id
    join forecast_item_results r on r.snapshot_id=rec.forecast_snapshot_id and r.inventory_item_id=(rec.value->>'itemId')::uuid
    join inventory_items i on i.id=r.inventory_item_id
    join units_of_measure u on u.id=i.base_unit_id
    where true ${itemFilter(filters)} ${categoryFilter(filters)}
    order by case r.risk_level when 'urgent' then 1 when 'shortage' then 2 when 'watch' then 3 else 4 end, r.recommended_quantity desc, lower(i.name)
  `, maxRows, offset);
}

async function inventoryCountSheet(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  return bounded(sql`
    select i.name as item, coalesce(b.lot_code, 'Unlabeled') as lot, coalesce(s.name, 'Unassigned') as storage,
      coalesce(b.expiration_date::text, '') as expiration_date, b.physical_on_hand::text as expected_quantity,
      u.abbreviation as unit, ''::text as physical_count, ''::text as notes
    from inventory_lot_balances b join inventory_items i on i.id=b.inventory_item_id
    join units_of_measure u on u.id=i.base_unit_id left join storage_locations s on s.id=b.storage_location_id
    where b.organization_id=${scope.organizationId}::uuid and b.pantry_location_id=${scope.locationId}::uuid and b.lot_status <> 'archived'
      ${itemFilter(filters)} ${categoryFilter(filters)}
    order by lower(i.name), b.expiration_date nulls last, b.received_date, b.inventory_lot_id
  `, maxRows, offset);
}

async function transferManifest(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const statusFilter = filters.transferStatus ? sql`and t.status::text=${filters.transferStatus}` : empty;
  return bounded(sql`
    select t.transfer_number, replace(t.status::text, '_', ' ') as status, source.name as source, destination.name as destination,
      i.name as item, coalesce(lot.lot_code, 'Unlabeled') as lot, tl.requested_base_quantity::text as requested,
      tl.dispatched_base_quantity::text as dispatched, tl.received_base_quantity::text as received,
      greatest(tl.dispatched_base_quantity-tl.received_base_quantity,0)::text as in_transit, u.abbreviation as unit
    from inventory_transfers t join inventory_transfer_lines tl on tl.transfer_id=t.id
    join pantry_locations source on source.id=t.source_location_id join pantry_locations destination on destination.id=t.destination_location_id
    join inventory_items i on i.id=tl.inventory_item_id join inventory_lots lot on lot.id=tl.source_lot_id
    join units_of_measure u on u.id=i.base_unit_id
    where t.organization_id=${scope.organizationId}::uuid and ${scope.locationId}::uuid in(t.source_location_id,t.destination_location_id)
      and ${dateRange(sql`t.created_at`, scope, filters)} ${statusFilter} ${itemFilter(filters)} ${categoryFilter(filters)}
    order by t.created_at desc, t.transfer_number, lower(i.name)
  `, maxRows, offset);
}

async function transfers(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const statusFilter = filters.transferStatus ? sql`and t.status::text=${filters.transferStatus}` : empty;
  return bounded(sql`
    select to_char(t.created_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as created_at,
      t.transfer_number, source.name as source, destination.name as destination, replace(t.status::text, '_', ' ') as status,
      count(tl.id)::text as line_count, coalesce(sum(greatest(tl.dispatched_base_quantity-tl.received_base_quantity,0)),0)::text as in_transit
    from inventory_transfers t left join inventory_transfer_lines tl on tl.transfer_id=t.id
    join pantry_locations source on source.id=t.source_location_id join pantry_locations destination on destination.id=t.destination_location_id
    where t.organization_id=${scope.organizationId}::uuid and ${scope.locationId}::uuid in(t.source_location_id,t.destination_location_id)
      and ${dateRange(sql`t.created_at`, scope, filters)} ${statusFilter}
    group by t.id, source.name, destination.name order by t.created_at desc
  `, maxRows, offset);
}

async function alerts(scope: ReportScope, filters: ReportFilters, maxRows: number, offset: number) {
  const typeFilter = filters.alertType ? sql`and a.alert_type=${filters.alertType}` : empty;
  return bounded(sql`
    select to_char(a.last_detected_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI') as last_detected_at,
      replace(a.alert_type, '_', ' ') as alert_type, a.severity::text, a.status::text, a.title,
      a.occurrence_count::text as occurrences, coalesce(to_char(a.resolved_at at time zone ${scope.timezone}, 'YYYY-MM-DD HH24:MI'), '') as resolved_at
    from operational_alerts a
    where a.organization_id=${scope.organizationId}::uuid and a.pantry_location_id=${scope.locationId}::uuid
      and ${dateRange(sql`a.last_detected_at`, scope, filters)} ${typeFilter}
    order by case a.severity when 'critical' then 1 when 'warning' then 2 else 3 end, a.last_detected_at desc
  `, maxRows, offset);
}

export async function loadReport(scope: ReportScope, reportType: ReportType, filters: ReportFilters, options: LoadOptions = {}): Promise<ReportData> {
  const maxRows = options.maxRows ?? filters.perPage;
  const offset = options.offset ?? (filters.page - 1) * filters.perPage;
  const result = await (async () => {
    switch (reportType) {
      case "inventory-on-hand": return inventoryOnHand(scope, filters, maxRows, offset);
      case "expiring-inventory": return expiringInventory(scope, filters, maxRows, offset);
      case "inventory-quality": return inventoryQuality(scope, filters, maxRows, offset);
      case "inventory-transactions": return inventoryTransactions(scope, filters, maxRows, offset);
      case "donations": return donations(scope, filters, maxRows, offset);
      case "donor-contributions": return donorContributions(scope, filters, maxRows, offset);
      case "receiving": return receiving(scope, filters, maxRows, offset);
      case "distributions": return distributions(scope, filters, maxRows, offset);
      case "pickup-schedule": return pickupSchedule(scope, filters, maxRows, offset);
      case "forecasts": return forecasts(scope, filters, maxRows, offset);
      case "messaging": return messaging(scope, filters, maxRows, offset);
      case "weekly-summary": return weeklySummary(scope, filters);
      case "donation-needs": return donationNeeds(scope, filters, maxRows, offset);
      case "inventory-count-sheet": return inventoryCountSheet(scope, filters, maxRows, offset);
      case "transfer-manifest": return transferManifest(scope, filters, maxRows, offset);
      case "transfers": return transfers(scope, filters, maxRows, offset);
      case "alerts": return alerts(scope, filters, maxRows, offset);
    }
  })();
  const definition = reportDefinitions[reportType];
  return {
    reportType,
    title: definition.title,
    description: definition.description,
    columns: definition.columns,
    rows: result.rows,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    page: filters.page,
    perPage: filters.perPage,
    hasNext: result.hasNext,
    generatedAt: new Date().toISOString(),
  };
}
