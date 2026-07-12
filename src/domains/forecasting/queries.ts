import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";

export async function latestForecast(organizationId:string,locationId:string) {
  const snapshots=await db.execute<{id:string;as_of:string;horizon_end:string;generated_at:string}>(sql`select id,as_of::text,horizon_end::text,generated_at::text from forecast_snapshots where organization_id=${organizationId} and pantry_location_id=${locationId} and status='completed' order by generated_at desc limit 1`);
  const snapshot=snapshots.rows[0]; if(!snapshot) return null;
  const [items,categories,diagnostics]=await Promise.all([
    db.execute<{inventory_item_id:string;name:string;available_quantity:string;weighted_daily_demand:string|null;days_of_supply:string|null;projected_shortage_date:string|null;recommended_quantity:string;confidence_score:number;confidence_level:string;risk_level:string}>(sql`select r.inventory_item_id,i.name,r.available_quantity::text,r.weighted_daily_demand::text,r.days_of_supply::text,r.projected_shortage_date::text,r.recommended_quantity::text,r.confidence_score,r.confidence_level,r.risk_level from forecast_item_results r join inventory_items i on i.id=r.inventory_item_id where r.snapshot_id=${snapshot.id} order by case r.risk_level when 'urgent' then 1 when 'shortage' then 2 when 'watch' then 3 else 4 end,i.name`),
    db.execute<{inventory_category_id:string;name:string;available_service_units:string;coverage_days:string|null;recommended_service_units:string;mapping_coverage_percent:string;confidence_score:number;risk_level:string}>(sql`select r.inventory_category_id,c.name,r.available_service_units::text,r.coverage_days::text,r.recommended_service_units::text,r.mapping_coverage_percent::text,r.confidence_score,r.risk_level from forecast_category_results r join inventory_categories c on c.id=r.inventory_category_id where r.snapshot_id=${snapshot.id} order by case r.risk_level when 'urgent' then 1 when 'shortage' then 2 when 'watch' then 3 else 4 end,c.name`),
    db.execute<{code:string;severity:string;message:string;inventory_item_id:string|null;inventory_category_id:string|null}>(sql`select code,severity,message,inventory_item_id,inventory_category_id from forecast_diagnostics where snapshot_id=${snapshot.id} order by severity desc,code`),
  ]);
  return {snapshot,items:items.rows,categories:categories.rows,diagnostics:diagnostics.rows};
}

export async function getItemForecast(organizationId:string,locationId:string,itemId:string) {
  const result=await db.execute<Record<string,unknown>>(sql`select r.*,i.name,u.abbreviation as base_unit,s.generated_at,s.as_of,s.horizon_end from forecast_item_results r join forecast_snapshots s on s.id=r.snapshot_id join inventory_items i on i.id=r.inventory_item_id join units_of_measure u on u.id=i.base_unit_id where r.organization_id=${organizationId} and r.pantry_location_id=${locationId} and r.inventory_item_id=${itemId} order by s.generated_at desc limit 1`);
  if(!result.rows[0]) return null;
  const diagnostics=await db.execute<{code:string;severity:string;message:string;details:unknown}>(sql`select d.code,d.severity,d.message,d.details from forecast_diagnostics d where d.snapshot_id=${String(result.rows[0].snapshot_id)} and d.inventory_item_id=${itemId}`);
  return {result:result.rows[0],diagnostics:diagnostics.rows};
}

export async function listAlerts(organizationId:string,locationId:string,status?:string) {
  const result=await db.execute<{id:string;alert_type:string;severity:string;status:string;title:string;summary:string;source_id:string|null;occurrence_count:number;last_detected_at:string;details:Record<string,unknown>}>(sql`select id,alert_type,severity,status,title,summary,source_id,occurrence_count,last_detected_at::text,details from operational_alerts where organization_id=${organizationId} and pantry_location_id=${locationId} and (${status??""}='' or status::text=${status??""}) order by case severity when 'critical' then 1 when 'warning' then 2 else 3 end,last_detected_at desc`); return result.rows;
}

export async function expirationRisk(organizationId:string,locationId:string) {
  const result=await db.execute<{lot_id:string;lot_code:string;item_id:string;item_name:string;expiration_date:string|null;available_quantity:string;risk:string}>(sql`select l.id lot_id,l.lot_code,i.id item_id,i.name item_name,l.expiration_date::text,b.available_quantity::text,case when l.expiration_date is null then 'missing' when l.expiration_date<current_date then 'expired' when l.expiration_date<=current_date+interval '7 days' then 'urgent' when l.expiration_date<=current_date+interval '30 days' then 'warning' else 'healthy' end risk from inventory_lots l join inventory_items i on i.id=l.inventory_item_id join inventory_lot_balances b on b.inventory_lot_id=l.id where l.organization_id=${organizationId} and l.pantry_location_id=${locationId} and b.physical_on_hand>0 and (l.expiration_date is null or l.expiration_date<=current_date+interval '30 days') order by l.expiration_date nulls first,i.name`);return result.rows;
}

export async function latestDonationNeeds(organizationId:string,locationId:string) { const result=await db.execute<{id:string;generated_at:string;recommendations:Array<Record<string,unknown>>}>(sql`select id,generated_at::text,recommendations from donation_need_snapshots where organization_id=${organizationId} and pantry_location_id=${locationId} order by generated_at desc limit 1`);return result.rows[0]??null; }

export async function forecastConfiguration(organizationId:string,locationId:string) { const result=await db.execute<Record<string,unknown>>(sql`select * from forecast_configurations where organization_id=${organizationId} and (scope_type='organization_default' or pantry_location_id=${locationId}) and is_active and archived_at is null order by case scope_type when 'item_override' then 1 when 'category_override' then 2 when 'location_default' then 3 else 4 end`);return result.rows; }
