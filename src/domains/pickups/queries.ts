import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import {
  appointmentAllocationLines,
  appointmentAllocations,
  appointments,
  appointmentStatusHistory,
  householdContacts,
  householdPreferences,
  households,
  householdSizePackageRules,
  inventoryCategories,
  inventoryItems,
  pickupPackageTemplates,
  smsConsents,
} from "@/lib/database/schema";

export async function listHouseholds(organizationId: string, search?: string) {
  const rows = await db.execute<{
    id: string;
    household_number: string;
    display_name: string;
    status: string;
    household_size: number;
    preferred_language: string;
    next_appointment_at: string | null;
    last_completed_at: string | null;
    duplicate_phone: boolean;
  }>(sql`
    select h.id, h.household_number, h.display_name, h.status, h.household_size, h.preferred_language,
      (select min(a.scheduled_start_at) from appointments a where a.household_id = h.id and a.status in ('scheduled','confirmed'))::text as next_appointment_at,
      (select max(a.completed_at) from appointments a where a.household_id = h.id and a.status in ('completed','partially_completed'))::text as last_completed_at,
      exists (
        select 1 from household_contacts c1
        join household_contacts c2 on c2.organization_id = c1.organization_id
          and c2.phone_normalized = c1.phone_normalized and c2.household_id <> c1.household_id
        where c1.household_id = h.id and c1.phone_normalized is not null and c1.is_active and c2.is_active
      ) as duplicate_phone
    from households h
    where h.organization_id = ${organizationId}
      and (${search ?? ""} = '' or h.display_name ilike ${"%" + (search ?? "") + "%"} or h.household_number ilike ${"%" + (search ?? "") + "%"})
    order by h.status asc, lower(h.display_name) asc
    limit 200
  `);
  return rows.rows;
}

export async function getHousehold(organizationId: string, householdId: string, access: { contacts: boolean; sensitive: boolean }) {
  const [household] = await db
    .select()
    .from(households)
    .where(and(eq(households.id, householdId), eq(households.organizationId, organizationId)))
    .limit(1);
  if (!household) return null;
  if (!access.sensitive) household.sensitiveNotes = null;

  const [contacts, preferences, consents, history] = await Promise.all([
    access.contacts
      ? db.select().from(householdContacts).where(eq(householdContacts.householdId, householdId)).orderBy(desc(householdContacts.isActive), asc(householdContacts.name))
      : Promise.resolve([]),
    db.select().from(householdPreferences).where(and(eq(householdPreferences.householdId, householdId), eq(householdPreferences.isActive, true))).orderBy(asc(householdPreferences.preferenceType)),
    access.contacts
      ? db.select().from(smsConsents).where(eq(smsConsents.householdId, householdId)).orderBy(desc(smsConsents.effectiveAt)).limit(20)
      : Promise.resolve([]),
    db
      .select({
        id: appointments.id,
        appointmentNumber: appointments.appointmentNumber,
        appointmentType: appointments.appointmentType,
        status: appointments.status,
        scheduledStartAt: appointments.scheduledStartAt,
        pantryLocationId: appointments.pantryLocationId,
      })
      .from(appointments)
      .where(eq(appointments.householdId, householdId))
      .orderBy(desc(appointments.scheduledStartAt))
      .limit(50),
  ]);
  return { household, contacts, preferences, consents, history };
}

export async function findDuplicateCandidates(organizationId: string, householdId: string) {
  const rows = await db.execute<{ id: string; display_name: string; household_number: string; reasons: string }>(sql`
    select distinct h2.id, h2.display_name, h2.household_number,
      concat_ws(', ',
        case when exists (
          select 1 from household_contacts c1 join household_contacts c2
            on c2.phone_normalized = c1.phone_normalized and c2.household_id = h2.id
          where c1.household_id = h1.id and c1.phone_normalized is not null and c1.is_active and c2.is_active
        ) then 'shared phone' end,
        case when exists (
          select 1 from household_contacts c1 join household_contacts c2
            on c2.email = c1.email and c2.household_id = h2.id
          where c1.household_id = h1.id and c1.email is not null and c1.is_active and c2.is_active
        ) then 'shared email' end,
        case when h1.external_reference is not null and h1.external_reference = h2.external_reference then 'same external reference' end
      ) as reasons
    from households h1
    join households h2 on h2.organization_id = h1.organization_id and h2.id <> h1.id and h2.status <> 'merged'
    where h1.id = ${householdId} and h1.organization_id = ${organizationId}
      and (
        exists (
          select 1 from household_contacts c1 join household_contacts c2
            on c2.phone_normalized = c1.phone_normalized and c2.household_id = h2.id
          where c1.household_id = h1.id and c1.phone_normalized is not null and c1.is_active and c2.is_active
        )
        or exists (
          select 1 from household_contacts c1 join household_contacts c2
            on c2.email = c1.email and c2.household_id = h2.id
          where c1.household_id = h1.id and c1.email is not null and c1.is_active and c2.is_active
        )
        or (h1.external_reference is not null and h1.external_reference = h2.external_reference)
      )
    limit 10
  `);
  return rows.rows;
}

export async function listPackageTemplates(organizationId: string) {
  const templates = await db
    .select()
    .from(pickupPackageTemplates)
    .where(and(eq(pickupPackageTemplates.organizationId, organizationId), sql`${pickupPackageTemplates.archivedAt} is null`))
    .orderBy(asc(pickupPackageTemplates.name));
  if (templates.length === 0) return [];
  const templateIds = templates.map((template) => template.id);
  const [lines, rules] = await Promise.all([
    db.execute<{ id: string; package_template_id: string; line_type: string; base_quantity: string; is_required: boolean; priority: number; item_name: string | null; category_name: string | null }>(sql`
      select l.id, l.package_template_id, l.line_type, l.base_quantity::text, l.is_required, l.priority,
        i.name as item_name, c.name as category_name
      from pickup_package_template_lines l
      left join inventory_items i on i.id = l.inventory_item_id
      left join inventory_categories c on c.id = l.inventory_category_id
      where l.package_template_id = any(${templateIds}::uuid[])
      order by l.priority asc
    `),
    db.select().from(householdSizePackageRules).where(and(sql`${householdSizePackageRules.packageTemplateId} = any(${templateIds}::uuid[])`, sql`${householdSizePackageRules.archivedAt} is null`)).orderBy(asc(householdSizePackageRules.minimumHouseholdSize)),
  ]);
  return templates.map((template) => ({
    template,
    lines: lines.rows.filter((line) => line.package_template_id === template.id),
    rules: rules.filter((rule) => rule.packageTemplateId === template.id),
  }));
}

export async function listAppointments(organizationId: string, pantryLocationId: string, range: { from: Date; to: Date }) {
  const rows = await db.execute<{
    id: string;
    appointment_number: string;
    appointment_type: string;
    status: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
    household_name: string;
    household_size_snapshot: number;
    package_name: string | null;
    reservation_status: string | null;
    critical_flags: string | null;
  }>(sql`
    select a.id, a.appointment_number, a.appointment_type, a.status,
      a.scheduled_start_at::text, a.scheduled_end_at::text,
      h.display_name as household_name, a.household_size_snapshot,
      t.name as package_name,
      r.status as reservation_status,
      (
        select string_agg(p.display_label, ', ')
        from household_preferences p
        where p.household_id = h.id and p.is_active and p.severity = 'critical'
      ) as critical_flags
    from appointments a
    join households h on h.id = a.household_id
    left join pickup_package_templates t on t.id = a.package_template_id
    left join inventory_reservations r on r.appointment_id = a.id and r.status in ('active','partially_fulfilled')
    where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
      and a.scheduled_start_at >= ${range.from} and a.scheduled_start_at < ${range.to}
    order by a.scheduled_start_at asc
    limit 300
  `);
  return rows.rows;
}

export async function getAppointmentDetail(organizationId: string, appointmentId: string) {
  const [appointment] = await db.execute<{
    id: string;
    appointment_number: string;
    appointment_type: string;
    status: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
    pantry_location_id: string;
    household_id: string;
    household_name: string;
    household_number: string;
    household_size_snapshot: number;
    preferred_language_snapshot: string | null;
    special_instructions: string | null;
    package_template_id: string | null;
    package_name: string | null;
    checked_in_at: string | null;
    cancellation_reason: string | null;
    rescheduled_to_appointment_id: string | null;
    rescheduled_from_appointment_id: string | null;
  }>(sql`
    select a.id, a.appointment_number, a.appointment_type, a.status,
      a.scheduled_start_at::text, a.scheduled_end_at::text, a.pantry_location_id,
      a.household_id, h.display_name as household_name, h.household_number,
      a.household_size_snapshot, a.preferred_language_snapshot, a.special_instructions,
      a.package_template_id, t.name as package_name, a.checked_in_at::text,
      a.cancellation_reason, a.rescheduled_to_appointment_id, a.rescheduled_from_appointment_id
    from appointments a
    join households h on h.id = a.household_id
    left join pickup_package_templates t on t.id = a.package_template_id
    where a.id = ${appointmentId} and a.organization_id = ${organizationId}
    limit 1
  `).then((result) => result.rows);
  if (!appointment) return null;

  const [allocationRows, reservationRows, fulfillmentRows, historyRows, preferenceRows] = await Promise.all([
    db.execute<{ id: string; line_type: string; requested_base_quantity: string; is_required: boolean; item_name: string | null; category_name: string | null; base_unit: string | null }>(sql`
      select l.id, l.line_type, l.requested_base_quantity::text, l.is_required,
        i.name as item_name, c.name as category_name, u.abbreviation as base_unit
      from appointment_allocations al
      join appointment_allocation_lines l on l.appointment_allocation_id = al.id
      left join inventory_items i on i.id = l.inventory_item_id
      left join units_of_measure u on u.id = i.base_unit_id
      left join inventory_categories c on c.id = l.inventory_category_id
      where al.appointment_id = ${appointmentId}
      order by l.priority asc
    `),
    db.execute<{
      reservation_id: string;
      reservation_status: string;
      expires_at: string | null;
      line_id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      requested: string;
      reserved: string;
      fulfilled: string;
      released: string;
      lot_id: string | null;
      lot_code: string | null;
      lot_reserved: string | null;
      lot_fulfilled: string | null;
      lot_status: string | null;
      storage_name: string | null;
      expiration_date: string | null;
    }>(sql`
      select r.id as reservation_id, r.status as reservation_status, r.expires_at::text,
        rl.id as line_id, rl.inventory_item_id as item_id, i.name as item_name, u.abbreviation as base_unit,
        rl.requested_base_quantity::text as requested, rl.reserved_base_quantity::text as reserved,
        rl.fulfilled_base_quantity::text as fulfilled, rl.released_base_quantity::text as released,
        la.inventory_lot_id as lot_id, lot.lot_code, la.reserved_base_quantity::text as lot_reserved,
        la.fulfilled_base_quantity::text as lot_fulfilled, la.status as lot_status,
        s.name as storage_name, lot.expiration_date::text
      from inventory_reservations r
      join inventory_reservation_lines rl on rl.reservation_id = r.id
      join inventory_items i on i.id = rl.inventory_item_id
      join units_of_measure u on u.id = i.base_unit_id
      left join inventory_reservation_lot_allocations la on la.reservation_line_id = rl.id
      left join inventory_lots lot on lot.id = la.inventory_lot_id
      left join storage_locations s on s.id = lot.storage_location_id
      where r.appointment_id = ${appointmentId}
      order by r.created_at desc, rl.created_at asc, lot.expiration_date asc nulls last
    `),
    db.execute<{ id: string; status: string; completed_at: string | null; correction_reason: string | null; item_name: string; lot_code: string | null; fulfilled: string; transaction_id: string | null }>(sql`
      select f.id, f.status, f.completed_at::text, f.correction_reason,
        i.name as item_name, lot.lot_code, fl.fulfilled_base_quantity::text as fulfilled, fl.inventory_transaction_id as transaction_id
      from pickup_fulfillments f
      left join pickup_fulfillment_lines fl on fl.pickup_fulfillment_id = f.id
      left join inventory_items i on i.id = fl.inventory_item_id
      left join inventory_lots lot on lot.id = fl.inventory_lot_id
      where f.appointment_id = ${appointmentId}
      order by f.created_at desc
    `),
    db
      .select()
      .from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.appointmentId, appointmentId))
      .orderBy(desc(appointmentStatusHistory.changedAt))
      .limit(30),
    db
      .select({ preferenceType: householdPreferences.preferenceType, displayLabel: householdPreferences.displayLabel, severity: householdPreferences.severity })
      .from(householdPreferences)
      .where(and(eq(householdPreferences.householdId, appointment.household_id), eq(householdPreferences.isActive, true))),
  ]);

  return {
    appointment,
    allocationLines: allocationRows.rows,
    reservationRows: reservationRows.rows,
    fulfillmentRows: fulfillmentRows.rows,
    history: historyRows,
    preferences: preferenceRows,
  };
}

export async function getPickupDashboard(organizationId: string, pantryLocationId: string) {
  const [row] = await db.execute<{
    today_total: string;
    checked_in: string;
    completed_today: string;
    active_reservations: string;
    expiring_soon: string;
    no_shows_today: string;
  }>(sql`
    select
      (select count(*) from appointments a where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
        and a.scheduled_start_at::date = current_date and a.status not in ('cancelled','rescheduled'))::text as today_total,
      (select count(*) from appointments a where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
        and a.status = 'arrived')::text as checked_in,
      (select count(*) from appointments a where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
        and a.status in ('completed','partially_completed') and a.completed_at::date = current_date)::text as completed_today,
      (select count(*) from inventory_reservations r where r.organization_id = ${organizationId} and r.pantry_location_id = ${pantryLocationId}
        and r.status in ('active','partially_fulfilled'))::text as active_reservations,
      (select count(*) from inventory_reservations r where r.organization_id = ${organizationId} and r.pantry_location_id = ${pantryLocationId}
        and r.status in ('active','partially_fulfilled') and r.expires_at is not null and r.expires_at < now() + interval '24 hours')::text as expiring_soon,
      (select count(*) from appointments a where a.organization_id = ${organizationId} and a.pantry_location_id = ${pantryLocationId}
        and a.status = 'no_show' and a.no_show_at::date = current_date)::text as no_shows_today
  `).then((result) => result.rows);
  return row;
}

export async function listActiveHouseholdOptions(organizationId: string) {
  return db
    .select({ id: households.id, displayName: households.displayName, householdNumber: households.householdNumber, householdSize: households.householdSize })
    .from(households)
    .where(and(eq(households.organizationId, organizationId), eq(households.status, "active")))
    .orderBy(asc(households.displayName))
    .limit(500);
}

export async function listTemplateOptions(organizationId: string) {
  return db
    .select({ id: pickupPackageTemplates.id, name: pickupPackageTemplates.name, packageType: pickupPackageTemplates.packageType })
    .from(pickupPackageTemplates)
    .where(and(eq(pickupPackageTemplates.organizationId, organizationId), sql`${pickupPackageTemplates.archivedAt} is null`))
    .orderBy(asc(pickupPackageTemplates.name));
}

export async function listPackageLineOptions(organizationId: string) {
  const [items, categories] = await Promise.all([
    db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, organizationId), sql`${inventoryItems.archivedAt} is null`)).orderBy(asc(inventoryItems.name)),
    db.select({ id: inventoryCategories.id, name: inventoryCategories.name }).from(inventoryCategories).where(and(eq(inventoryCategories.organizationId, organizationId), sql`${inventoryCategories.archivedAt} is null`)).orderBy(asc(inventoryCategories.name)),
  ]);
  return { items, categories };
}

export async function getAllocationForAppointment(organizationId: string, appointmentId: string) {
  const [allocation] = await db
    .select()
    .from(appointmentAllocations)
    .where(and(eq(appointmentAllocations.appointmentId, appointmentId), eq(appointmentAllocations.organizationId, organizationId)))
    .limit(1);
  if (!allocation) return null;
  const lines = await db.select().from(appointmentAllocationLines).where(eq(appointmentAllocationLines.appointmentAllocationId, allocation.id)).orderBy(asc(appointmentAllocationLines.priority));
  return { allocation, lines };
}
