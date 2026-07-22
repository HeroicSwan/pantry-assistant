import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";

export type TodayAtGlanceAccess = {
  appointments: boolean;
  inventory: boolean;
  alerts: boolean;
  inboundMessages: boolean;
};

export async function getTodayAtGlance(
  organizationId: string,
  locationId: string,
  access: TodayAtGlanceAccess,
) {
  const [pickups, inventory, alerts, messages] = await Promise.all([
    access.appointments
      ? db.execute<{
          due: number;
          arrived: number;
          next_appointment_id: string | null;
          next_household_name: string | null;
          next_status: string | null;
          next_start_at: string | null;
        }>(sql`
          select
            count(*) filter(where a.status in ('scheduled','confirmed','arrived'))::int as due,
            count(*) filter(where a.status = 'arrived')::int as arrived,
            (
              select a2.id from appointments a2
              where a2.organization_id = ${organizationId}
                and a2.pantry_location_id = ${locationId}
                and a2.scheduled_start_at::date = current_date
                and a2.status in ('arrived','scheduled','confirmed')
              order by case when a2.status = 'arrived' then 0 else 1 end, a2.scheduled_start_at
              limit 1
            ) as next_appointment_id,
            (
              select h.display_name from appointments a2
              join households h on h.id = a2.household_id
              where a2.organization_id = ${organizationId}
                and a2.pantry_location_id = ${locationId}
                and a2.scheduled_start_at::date = current_date
                and a2.status in ('arrived','scheduled','confirmed')
              order by case when a2.status = 'arrived' then 0 else 1 end, a2.scheduled_start_at
              limit 1
            ) as next_household_name,
            (
              select a2.status::text from appointments a2
              where a2.organization_id = ${organizationId}
                and a2.pantry_location_id = ${locationId}
                and a2.scheduled_start_at::date = current_date
                and a2.status in ('arrived','scheduled','confirmed')
              order by case when a2.status = 'arrived' then 0 else 1 end, a2.scheduled_start_at
              limit 1
            ) as next_status,
            (
              select a2.scheduled_start_at::text from appointments a2
              where a2.organization_id = ${organizationId}
                and a2.pantry_location_id = ${locationId}
                and a2.scheduled_start_at::date = current_date
                and a2.status in ('arrived','scheduled','confirmed')
              order by case when a2.status = 'arrived' then 0 else 1 end, a2.scheduled_start_at
              limit 1
            ) as next_start_at
          from appointments a
          where a.organization_id = ${organizationId}
            and a.pantry_location_id = ${locationId}
            and a.scheduled_start_at::date = current_date
        `)
      : Promise.resolve(null),
    access.inventory
      ? db.execute<{ expiring: number }>(sql`
          select count(*)::int as expiring
          from inventory_lots l
          join inventory_lot_balances b on b.inventory_lot_id = l.id
          where l.organization_id = ${organizationId}
            and l.pantry_location_id = ${locationId}
            and b.physical_on_hand > 0
            and (l.expiration_date is null or l.expiration_date <= current_date + interval '30 days')
        `)
      : Promise.resolve(null),
    access.alerts
      ? db.execute<{ unresolved: number; low_stock: number }>(sql`
          select
            count(*) filter(where status in ('open','acknowledged'))::int as unresolved,
            count(*) filter(where status in ('open','acknowledged') and alert_type in ('low_stock','urgent_shortage','projected_shortage'))::int as low_stock
          from operational_alerts
          where organization_id = ${organizationId}
            and pantry_location_id = ${locationId}
        `)
      : Promise.resolve(null),
    access.inboundMessages
      ? db.execute<{ awaiting_review: number }>(sql`
          select count(*)::int as awaiting_review
          from inbound_messages
          where organization_id = ${organizationId}
            and pantry_location_id = ${locationId}
            and processing_status = 'review_required'
        `)
      : Promise.resolve(null),
  ]);

  return {
    pickups: pickups?.rows[0] ?? null,
    inventory: inventory?.rows[0] ?? null,
    alerts: alerts?.rows[0] ?? null,
    messages: messages?.rows[0] ?? null,
  };
}
