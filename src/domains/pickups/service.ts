import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as rawDb } from "@/lib/database/client";
import {
  hasLocationPermission,
  hasPermissionAnywhereInOrganization,
} from "@/lib/database/authorization";
import {
  appointmentAllocationLines,
  appointmentAllocations,
  appointments,
  appointmentStatusHistory,
  auditLogs,
  householdContacts,
  householdPreferences,
  households,
  householdSizePackageRules,
  inventoryItems,
  inventoryReservationLines,
  inventoryReservationLotAllocations,
  inventoryReservations,
  organizationMemberships,
  pickupFulfillmentLines,
  pickupFulfillments,
  pickupPackageTemplateLines,
  pickupPackageTemplates,
  pickupSubstitutions,
  smsConsents,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";
import { postInventoryTransaction, reverseInventoryTransaction } from "@/domains/inventory/ledger";
import {
  applySizeMultiplier,
  canTransitionAppointment,
  cancellationEligible,
  checkInEligible,
  noShowEligible,
  normalizePhone,
  planFefoAllocation,
  rescheduleEligible,
  selectSizeRule,
  substitutionConflicts,
  validateHouseholdCounts,
  type AppointmentStatus,
} from "@/domains/pickups/policy";

type Transaction = Parameters<Parameters<typeof rawDb.transaction>[0]>[0];

const SAFE_DATABASE_ERRORS = new Set([
  "INSUFFICIENT_STOCK",
  "LOT_ARCHIVED",
  "TRANSACTION_SIGN_INVALID",
  "APPOINTMENT_INVALID_STATE",
  "RESERVATION_INVALID_STATE",
  "FULFILLMENT_IMMUTABLE",
  "HOUSEHOLD_NOT_ELIGIBLE",
  "OPERATION_RECORD_IMMUTABLE",
]);

function databaseCause(error: unknown): { code?: string; message?: string } | null {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return { code: candidate.code, message: typeof candidate.message === "string" ? candidate.message : undefined };
    current = candidate.cause;
  }
  return null;
}

const db = {
  async transaction<T>(run: (tx: Transaction) => Promise<T>) {
    try {
      return await rawDb.transaction(run);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const cause = databaseCause(error);
      if (cause?.message && SAFE_DATABASE_ERRORS.has(cause.message)) throw new DomainError(cause.message);
      if (cause) throw Object.assign(new Error("DATABASE_OPERATION_FAILED"), { code: cause.code });
      throw error;
    }
  },
};

async function actorMembership(tx: Transaction, actorId: string, organizationId: string) {
  const [membership] = await tx
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, actorId), eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, "active")))
    .limit(1);
  if (!membership) throw new DomainError("FORBIDDEN");
  return membership.id;
}

async function requireOrgWidePermission(tx: Transaction, actorId: string, organizationId: string, permission: string) {
  if (!(await hasPermissionAnywhereInOrganization(tx, actorId, organizationId, permission))) throw new DomainError("FORBIDDEN");
}

async function requireLocationPermission(tx: Transaction, actorId: string, locationId: string, permission: string) {
  if (!(await hasLocationPermission(tx, actorId, locationId, permission))) throw new DomainError("FORBIDDEN");
}

async function writeAudit(
  tx: Transaction,
  actorId: string,
  organizationId: string,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    locationId?: string | null;
    requestId: string;
    reason?: string | null;
    newValues?: Record<string, unknown>;
    previousValues?: Record<string, unknown>;
  },
) {
  await tx.insert(auditLogs).values({
    organizationId,
    locationId: entry.locationId ?? null,
    actorUserId: actorId,
    actorMembershipId: await actorMembership(tx, actorId, organizationId),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    requestId: entry.requestId,
    reason: entry.reason ?? null,
    newValues: entry.newValues,
    previousValues: entry.previousValues,
  });
}

function referenceNumber(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// Quantities are numeric(20,6) strings; pantry magnitudes are far below float53 limits.
const asQ = (value: string | number) => (typeof value === "number" ? value : Number(value));
const fmtQ = (value: number) => value.toFixed(6);

// --- Households ---------------------------------------------------------------

export type HouseholdInput = {
  displayName: string;
  preferredLanguage?: string;
  householdSize: number;
  adultCount?: number | null;
  childCount?: number | null;
  seniorCount?: number | null;
  defaultPantryLocationId?: string | null;
  operationalNotes?: string | null;
  externalReference?: string | null;
};

export async function createHousehold(actorId: string, organizationId: string, values: HouseholdInput, requestId: string) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "household.create");
    if (!validateHouseholdCounts(values)) throw new DomainError("HOUSEHOLD_SIZE_INVALID");
    const [household] = await tx
      .insert(households)
      .values({
        organizationId,
        householdNumber: referenceNumber("H"),
        displayName: values.displayName,
        preferredLanguage: values.preferredLanguage || "en",
        householdSize: values.householdSize,
        adultCount: values.adultCount ?? null,
        childCount: values.childCount ?? null,
        seniorCount: values.seniorCount ?? null,
        defaultPantryLocationId: values.defaultPantryLocationId || null,
        operationalNotes: values.operationalNotes || null,
        externalReference: values.externalReference || null,
        createdBy: actorId,
      })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "household.created", entityType: "household", entityId: household.id, requestId, newValues: { householdNumber: household.householdNumber, displayName: household.displayName, householdSize: household.householdSize } });
    return household;
  });
}

export async function updateHousehold(actorId: string, organizationId: string, householdId: string, values: HouseholdInput, requestId: string) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "household.update");
    if (!validateHouseholdCounts(values)) throw new DomainError("HOUSEHOLD_SIZE_INVALID");
    const [previous] = await tx.select().from(households).where(and(eq(households.id, householdId), eq(households.organizationId, organizationId))).limit(1);
    if (!previous) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    if (previous.status === "merged") throw new DomainError("HOUSEHOLD_NOT_ELIGIBLE");
    const [updated] = await tx
      .update(households)
      .set({
        displayName: values.displayName,
        preferredLanguage: values.preferredLanguage || previous.preferredLanguage,
        householdSize: values.householdSize,
        adultCount: values.adultCount ?? null,
        childCount: values.childCount ?? null,
        seniorCount: values.seniorCount ?? null,
        defaultPantryLocationId: values.defaultPantryLocationId || null,
        operationalNotes: values.operationalNotes || null,
        externalReference: values.externalReference || null,
      })
      .where(eq(households.id, householdId))
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "household.updated", entityType: "household", entityId: householdId, requestId, previousValues: { displayName: previous.displayName, householdSize: previous.householdSize }, newValues: { displayName: updated.displayName, householdSize: updated.householdSize } });
    return updated;
  });
}

export async function archiveHousehold(actorId: string, organizationId: string, householdId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "household.archive");
    const [previous] = await tx.select().from(households).where(and(eq(households.id, householdId), eq(households.organizationId, organizationId))).limit(1);
    if (!previous) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    const [updated] = await tx.update(households).set({ status: "archived", archivedAt: new Date() }).where(eq(households.id, householdId)).returning();
    await writeAudit(tx, actorId, organizationId, { action: "household.archived", entityType: "household", entityId: householdId, requestId, reason, previousValues: { status: previous.status }, newValues: { status: updated.status } });
    return updated;
  });
}

export async function addHouseholdContact(
  actorId: string,
  organizationId: string,
  householdId: string,
  values: { contactType: typeof householdContacts.$inferInsert.contactType; name: string; relationshipLabel?: string | null; phoneNumber?: string | null; email?: string | null; isAuthorizedPickup?: boolean },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "household.view_contact");
    await requireOrgWidePermission(tx, actorId, organizationId, "household.update");
    const [household] = await tx.select({ id: households.id, status: households.status }).from(households).where(and(eq(households.id, householdId), eq(households.organizationId, organizationId))).limit(1);
    if (!household) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    const [contact] = await tx
      .insert(householdContacts)
      .values({
        organizationId,
        householdId,
        contactType: values.contactType,
        name: values.name,
        relationshipLabel: values.relationshipLabel || null,
        phoneNumber: values.phoneNumber || null,
        phoneNormalized: normalizePhone(values.phoneNumber),
        email: values.email?.trim().toLowerCase() || null,
        isAuthorizedPickup: values.isAuthorizedPickup ?? false,
        createdBy: actorId,
      })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "household.contact_added", entityType: "household_contact", entityId: contact.id, requestId, newValues: { householdId, contactType: contact.contactType, hasPhone: Boolean(contact.phoneNormalized) } });
    return contact;
  });
}

export async function addHouseholdPreference(
  actorId: string,
  organizationId: string,
  householdId: string,
  values: { preferenceType: typeof householdPreferences.$inferInsert.preferenceType; valueCode: string; displayLabel: string; severity: "info" | "warning" | "critical"; notes?: string | null },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "household.update");
    const [household] = await tx.select({ id: households.id }).from(households).where(and(eq(households.id, householdId), eq(households.organizationId, organizationId))).limit(1);
    if (!household) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    const [preference] = await tx
      .insert(householdPreferences)
      .values({ organizationId, householdId, preferenceType: values.preferenceType, valueCode: values.valueCode, displayLabel: values.displayLabel, severity: values.severity, notes: values.notes || null, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "household.preference_added", entityType: "household_preference", entityId: preference.id, requestId, newValues: { householdId, preferenceType: preference.preferenceType, valueCode: preference.valueCode, severity: preference.severity } });
    return preference;
  });
}

export async function recordSmsConsent(
  actorId: string,
  organizationId: string,
  householdId: string,
  values: { householdContactId?: string | null; phoneNumber: string; status: typeof smsConsents.$inferInsert.status; consentSource: typeof smsConsents.$inferInsert.consentSource; notes?: string | null },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "consent.record");
    const [household] = await tx.select({ id: households.id }).from(households).where(and(eq(households.id, householdId), eq(households.organizationId, organizationId))).limit(1);
    if (!household) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    const phoneNormalized = normalizePhone(values.phoneNumber);
    if (!phoneNormalized) throw new DomainError("CONSENT_INVALID");
    // Consent history is append-only: each change is a new row; the latest effective row wins.
    const [consent] = await tx
      .insert(smsConsents)
      .values({ organizationId, householdId, householdContactId: values.householdContactId || null, phoneNormalized, status: values.status, consentSource: values.consentSource, recordedBy: actorId, notes: values.notes || null })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "consent.recorded", entityType: "sms_consent", entityId: consent.id, requestId, newValues: { householdId, status: consent.status, source: consent.consentSource } });
    return consent;
  });
}

// --- Package templates ----------------------------------------------------------

export async function createPackageTemplate(
  actorId: string,
  organizationId: string,
  values: { name: string; description?: string | null; packageType: string; pantryLocationId?: string | null; allowSubstitutions: boolean },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "package.manage");
    const [template] = await tx
      .insert(pickupPackageTemplates)
      .values({ organizationId, pantryLocationId: values.pantryLocationId || null, name: values.name, description: values.description || null, packageType: values.packageType, allowSubstitutions: values.allowSubstitutions, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "package.template_created", entityType: "pickup_package_template", entityId: template.id, requestId, newValues: { name: template.name, packageType: template.packageType } });
    return template;
  });
}

export async function addPackageTemplateLine(
  actorId: string,
  organizationId: string,
  templateId: string,
  values: { lineType: "exact_item" | "category_choice" | "optional_item"; inventoryItemId?: string | null; inventoryCategoryId?: string | null; baseQuantity: string; isRequired: boolean; allowSubstitution: boolean; priority: number },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "package.manage");
    const [template] = await tx.select({ id: pickupPackageTemplates.id }).from(pickupPackageTemplates).where(and(eq(pickupPackageTemplates.id, templateId), eq(pickupPackageTemplates.organizationId, organizationId), sql`${pickupPackageTemplates.archivedAt} is null`)).limit(1);
    if (!template) throw new DomainError("PACKAGE_TEMPLATE_NOT_FOUND");
    const [line] = await tx
      .insert(pickupPackageTemplateLines)
      .values({
        packageTemplateId: templateId,
        organizationId,
        lineType: values.lineType,
        inventoryItemId: values.lineType === "category_choice" ? null : values.inventoryItemId || null,
        inventoryCategoryId: values.lineType === "category_choice" ? values.inventoryCategoryId || null : null,
        baseQuantity: values.baseQuantity,
        isRequired: values.lineType !== "optional_item" && values.isRequired,
        allowSubstitution: values.allowSubstitution,
        priority: values.priority,
      })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "package.template_line_added", entityType: "pickup_package_template_line", entityId: line.id, requestId, newValues: { templateId, lineType: line.lineType, baseQuantity: line.baseQuantity } });
    return line;
  });
}

export async function addSizeRule(
  actorId: string,
  organizationId: string,
  templateId: string,
  values: { minimumHouseholdSize: number; maximumHouseholdSize: number | null; quantityMultiplier: string },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireOrgWidePermission(tx, actorId, organizationId, "package.manage");
    const existing = await tx
      .select({ minimumHouseholdSize: householdSizePackageRules.minimumHouseholdSize, maximumHouseholdSize: householdSizePackageRules.maximumHouseholdSize })
      .from(householdSizePackageRules)
      .where(and(eq(householdSizePackageRules.packageTemplateId, templateId), eq(householdSizePackageRules.organizationId, organizationId), sql`${householdSizePackageRules.archivedAt} is null`));
    const overlap = existing.some((rule) => {
      const existingMax = rule.maximumHouseholdSize ?? Number.POSITIVE_INFINITY;
      const newMax = values.maximumHouseholdSize ?? Number.POSITIVE_INFINITY;
      return values.minimumHouseholdSize <= existingMax && rule.minimumHouseholdSize <= newMax;
    });
    if (overlap) throw new DomainError("PACKAGE_RULE_OVERLAP");
    const [rule] = await tx
      .insert(householdSizePackageRules)
      .values({ organizationId, packageTemplateId: templateId, minimumHouseholdSize: values.minimumHouseholdSize, maximumHouseholdSize: values.maximumHouseholdSize, quantityMultiplier: values.quantityMultiplier, createdBy: actorId })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "package.size_rule_added", entityType: "household_size_package_rule", entityId: rule.id, requestId, newValues: { templateId, minimumHouseholdSize: rule.minimumHouseholdSize, maximumHouseholdSize: rule.maximumHouseholdSize, quantityMultiplier: rule.quantityMultiplier } });
    return rule;
  });
}

// --- Appointments ----------------------------------------------------------------

async function appendStatusHistory(tx: Transaction, appointment: { id: string; organizationId: string; pantryLocationId: string }, fromStatus: AppointmentStatus | null, toStatus: AppointmentStatus, actorId: string, reason?: string | null) {
  await tx.insert(appointmentStatusHistory).values({
    organizationId: appointment.organizationId,
    pantryLocationId: appointment.pantryLocationId,
    appointmentId: appointment.id,
    fromStatus,
    toStatus,
    reason: reason ?? null,
    changedBy: actorId,
  });
}

async function lockAppointment(tx: Transaction, organizationId: string, appointmentId: string) {
  const [appointment] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (!appointment) throw new DomainError("APPOINTMENT_NOT_FOUND");
  return appointment;
}

export async function createAppointment(
  actorId: string,
  organizationId: string,
  values: {
    householdId: string;
    pantryLocationId: string;
    appointmentType: typeof appointments.$inferInsert.appointmentType;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    packageTemplateId?: string | null;
    specialInstructions?: string | null;
    generateAllocation?: boolean;
    reserve?: boolean;
    checkInImmediately?: boolean;
    rescheduledFromAppointmentId?: string | null;
  },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await requireLocationPermission(tx, actorId, values.pantryLocationId, "appointment.create");
    if (values.scheduledStartAt >= values.scheduledEndAt) throw new DomainError("APPOINTMENT_TIME_INVALID");
    const [household] = await tx
      .select({ id: households.id, status: households.status, householdSize: households.householdSize, preferredLanguage: households.preferredLanguage })
      .from(households)
      .where(and(eq(households.id, values.householdId), eq(households.organizationId, organizationId)))
      .limit(1);
    if (!household) throw new DomainError("HOUSEHOLD_NOT_FOUND");
    if (household.status !== "active") throw new DomainError("HOUSEHOLD_NOT_ELIGIBLE");

    const [appointment] = await tx
      .insert(appointments)
      .values({
        organizationId,
        pantryLocationId: values.pantryLocationId,
        householdId: values.householdId,
        appointmentNumber: referenceNumber("A"),
        appointmentType: values.appointmentType,
        status: "scheduled",
        scheduledStartAt: values.scheduledStartAt,
        scheduledEndAt: values.scheduledEndAt,
        packageTemplateId: values.packageTemplateId || null,
        householdSizeSnapshot: household.householdSize,
        preferredLanguageSnapshot: household.preferredLanguage,
        specialInstructions: values.specialInstructions || null,
        rescheduledFromAppointmentId: values.rescheduledFromAppointmentId || null,
        createdBy: actorId,
      })
      .returning();
    await appendStatusHistory(tx, appointment, null, "scheduled", actorId, "Appointment created");
    await writeAudit(tx, actorId, organizationId, { action: "appointment.created", entityType: "appointment", entityId: appointment.id, locationId: appointment.pantryLocationId, requestId, newValues: { appointmentNumber: appointment.appointmentNumber, householdId: appointment.householdId, type: appointment.appointmentType, startAt: appointment.scheduledStartAt.toISOString() } });

    if (values.generateAllocation && appointment.packageTemplateId) {
      await generateAllocationInTx(tx, actorId, organizationId, appointment.id, requestId);
    }
    let reservationResult: Awaited<ReturnType<typeof createReservationInTx>> | null = null;
    if (values.reserve && appointment.packageTemplateId) {
      reservationResult = await createReservationInTx(tx, actorId, organizationId, appointment.id, { idempotencyKey: crypto.randomUUID() }, requestId);
    }
    if (values.checkInImmediately) {
      await checkInInTx(tx, actorId, organizationId, appointment.id, requestId);
    }
    return { appointment, reservation: reservationResult };
  });
}

async function generateAllocationInTx(tx: Transaction, actorId: string, organizationId: string, appointmentId: string, requestId: string) {
  const appointment = await lockAppointment(tx, organizationId, appointmentId);
  if (!appointment.packageTemplateId) throw new DomainError("PACKAGE_TEMPLATE_NOT_FOUND");
  const [template] = await tx
    .select()
    .from(pickupPackageTemplates)
    .where(and(eq(pickupPackageTemplates.id, appointment.packageTemplateId), eq(pickupPackageTemplates.organizationId, organizationId)))
    .limit(1);
  if (!template) throw new DomainError("PACKAGE_TEMPLATE_NOT_FOUND");
  const templateLines = await tx
    .select()
    .from(pickupPackageTemplateLines)
    .where(eq(pickupPackageTemplateLines.packageTemplateId, template.id))
    .orderBy(asc(pickupPackageTemplateLines.priority));
  const rules = await tx
    .select()
    .from(householdSizePackageRules)
    .where(and(eq(householdSizePackageRules.packageTemplateId, template.id), sql`${householdSizePackageRules.archivedAt} is null`));
  const rule = selectSizeRule(
    rules.map((candidate) => ({ id: candidate.id, minimumHouseholdSize: candidate.minimumHouseholdSize, maximumHouseholdSize: candidate.maximumHouseholdSize, quantityMultiplier: candidate.quantityMultiplier })),
    appointment.householdSizeSnapshot,
  );
  const multiplier = rule?.quantityMultiplier ?? "1";

  const [allocation] = await tx
    .insert(appointmentAllocations)
    .values({
      organizationId,
      pantryLocationId: appointment.pantryLocationId,
      appointmentId: appointment.id,
      packageTemplateId: template.id,
      templateSnapshot: { name: template.name, packageType: template.packageType, allowSubstitutions: template.allowSubstitutions, lines: templateLines.map((line) => ({ id: line.id, lineType: line.lineType, inventoryItemId: line.inventoryItemId, inventoryCategoryId: line.inventoryCategoryId, baseQuantity: line.baseQuantity, isRequired: line.isRequired, priority: line.priority })) },
      householdSizeSnapshot: appointment.householdSizeSnapshot,
      sizeMultiplierSnapshot: multiplier,
      generatedBy: actorId,
    })
    .returning();

  for (const line of templateLines) {
    await tx.insert(appointmentAllocationLines).values({
      appointmentAllocationId: allocation.id,
      organizationId,
      pantryLocationId: appointment.pantryLocationId,
      inventoryItemId: line.inventoryItemId,
      inventoryCategoryId: line.inventoryCategoryId,
      lineType: line.lineType,
      requestedBaseQuantity: applySizeMultiplier(line.baseQuantity, multiplier),
      isRequired: line.isRequired,
      allowSubstitution: line.allowSubstitution,
      priority: line.priority,
      sourceTemplateLineId: line.id,
    });
  }
  await writeAudit(tx, actorId, organizationId, { action: "appointment.allocation_generated", entityType: "appointment_allocation", entityId: allocation.id, locationId: appointment.pantryLocationId, requestId, newValues: { appointmentId: appointment.id, multiplier, lineCount: templateLines.length } });
  return allocation;
}

export async function generateAppointmentAllocation(actorId: string, organizationId: string, appointmentId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, organizationId, appointmentId);
    await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "appointment.update");
    return generateAllocationInTx(tx, actorId, organizationId, appointmentId, requestId);
  });
}

// --- Reservations ------------------------------------------------------------------

export type ReservationConflict = {
  inventoryItemId: string;
  itemName: string;
  requested: number;
  reservable: number;
  shortage: number;
  isRequired: boolean;
};

type LotAvailabilityRow = {
  lot_id: string;
  expiration_date: string | null;
  received_date: string;
  available: string;
};

/** Lock the item's lots and compute per-lot availability (valid unblocked physical minus active reserved). */
async function lockAndComputeLotAvailability(tx: Transaction, organizationId: string, pantryLocationId: string, itemId: string): Promise<LotAvailabilityRow[]> {
  // Deterministic lock order (lot id) prevents deadlocks between concurrent reservations.
  await tx.execute(sql`
    select id from inventory_lots
    where organization_id = ${organizationId} and pantry_location_id = ${pantryLocationId}
      and inventory_item_id = ${itemId} and status = 'active'
    order by id
    for update
  `);
  const result = await tx.execute<LotAvailabilityRow>(sql`
    select
      l.id as lot_id,
      l.expiration_date::text,
      l.received_date::text,
      greatest(
        coalesce(t.physical, 0) - coalesce(res.reserved, 0),
        0
      )::text as available
    from inventory_lots l
    join pantry_locations pl on pl.id = l.pantry_location_id
    join organizations o on o.id = l.organization_id
    left join (
      select inventory_lot_id, sum(physical_delta) as physical
      from inventory_transactions group by inventory_lot_id
    ) t on t.inventory_lot_id = l.id
    left join (
      select a.inventory_lot_id,
        sum(greatest(a.reserved_base_quantity - a.fulfilled_base_quantity - a.released_base_quantity, 0)) as reserved
      from inventory_reservation_lot_allocations a
      join inventory_reservation_lines rl on rl.id = a.reservation_line_id
      join inventory_reservations r on r.id = rl.reservation_id
      where a.status = 'active' and r.status in ('active', 'partially_fulfilled')
        and (r.expires_at is null or r.expires_at > now())
      group by a.inventory_lot_id
    ) res on res.inventory_lot_id = l.id
    where l.organization_id = ${organizationId} and l.pantry_location_id = ${pantryLocationId}
      and l.inventory_item_id = ${itemId} and l.status = 'active'
      and not (l.expiration_date is not null and l.expiration_date < (now() at time zone coalesce(pl.timezone, o.timezone))::date)
      and not exists (
        select 1 from inventory_lot_holds h
        where h.inventory_lot_id = l.id and h.status = 'active'
      )
  `);
  return result.rows;
}

async function resolveCategoryItem(tx: Transaction, organizationId: string, pantryLocationId: string, categoryId: string): Promise<string | null> {
  // Deterministic category resolution: the in-category item whose earliest-expiring lot has availability.
  const result = await tx.execute<{ item_id: string }>(sql`
    select b.inventory_item_id as item_id
    from inventory_lot_balances b
    join inventory_items i on i.id = b.inventory_item_id
    where b.organization_id = ${organizationId} and b.pantry_location_id = ${pantryLocationId}
      and i.category_id = ${categoryId} and i.status = 'active' and b.available_quantity > 0
    order by b.expiration_date asc nulls last, b.received_date asc, b.inventory_lot_id asc
    limit 1
  `);
  return result.rows[0]?.item_id ?? null;
}

async function createReservationInTx(
  tx: Transaction,
  actorId: string,
  organizationId: string,
  appointmentId: string,
  options: { expiresAt?: Date | null; idempotencyKey: string },
  requestId: string,
): Promise<{ reservation: typeof inventoryReservations.$inferSelect | null; conflicts: ReservationConflict[] }> {
  const appointment = await lockAppointment(tx, organizationId, appointmentId);
  await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "reservation.create");
  if (!["scheduled", "confirmed", "arrived"].includes(appointment.status)) throw new DomainError("APPOINTMENT_INVALID_STATE");

  const [existingByKey] = await tx
    .select()
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.idempotencyKey, options.idempotencyKey)))
    .limit(1);
  if (existingByKey) return { reservation: existingByKey, conflicts: [] };

  const [activeExisting] = await tx
    .select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.appointmentId, appointmentId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"])))
    .limit(1);
  if (activeExisting) throw new DomainError("RESERVATION_ALREADY_EXISTS");

  const [allocation] = await tx.select().from(appointmentAllocations).where(eq(appointmentAllocations.appointmentId, appointmentId)).limit(1);
  if (!allocation) throw new DomainError("ALLOCATION_NOT_FOUND");
  const allocationLines = await tx
    .select()
    .from(appointmentAllocationLines)
    .where(eq(appointmentAllocationLines.appointmentAllocationId, allocation.id))
    .orderBy(asc(appointmentAllocationLines.priority));

  // Resolve category lines and plan every line before writing anything.
  const planned: { allocationLine: typeof allocationLines[number]; itemId: string; itemName: string; requested: number; allocations: { lotId: string; quantity: number }[]; shortage: number }[] = [];
  const conflicts: ReservationConflict[] = [];
  for (const line of allocationLines) {
    let itemId = line.inventoryItemId;
    if (!itemId && line.inventoryCategoryId) {
      itemId = await resolveCategoryItem(tx, organizationId, appointment.pantryLocationId, line.inventoryCategoryId);
    }
    const requested = asQ(line.requestedBaseQuantity);
    if (!itemId) {
      conflicts.push({ inventoryItemId: line.inventoryCategoryId ?? "unknown", itemName: "No available item in category", requested, reservable: 0, shortage: requested, isRequired: line.isRequired });
      continue;
    }
    const [item] = await tx.select({ id: inventoryItems.id, name: inventoryItems.name, status: inventoryItems.status }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.organizationId, organizationId))).limit(1);
    if (!item || item.status !== "active") {
      conflicts.push({ inventoryItemId: itemId, itemName: item?.name ?? "Unknown item", requested, reservable: 0, shortage: requested, isRequired: line.isRequired });
      continue;
    }
    const lots = await lockAndComputeLotAvailability(tx, organizationId, appointment.pantryLocationId, itemId);
    const plan = planFefoAllocation(
      lots.map((lot) => ({ lotId: lot.lot_id, expirationDate: lot.expiration_date, receivedDate: lot.received_date, availableQuantity: asQ(lot.available) })),
      requested,
    );
    if (plan.shortage > 0) {
      conflicts.push({ inventoryItemId: itemId, itemName: item.name, requested, reservable: requested - plan.shortage, shortage: plan.shortage, isRequired: line.isRequired });
      if (line.isRequired) continue; // required shortage blocks the reservation below
    }
    planned.push({ allocationLine: line, itemId, itemName: item.name, requested, allocations: plan.allocations, shortage: plan.shortage });
  }

  const requiredConflict = conflicts.some((conflict) => conflict.isRequired);
  if (requiredConflict) {
    await writeAudit(tx, actorId, organizationId, { action: "reservation.conflict", entityType: "appointment", entityId: appointmentId, locationId: appointment.pantryLocationId, requestId, newValues: { conflicts: conflicts.map((conflict) => ({ item: conflict.itemName, shortage: conflict.shortage, required: conflict.isRequired })) } });
    return { reservation: null, conflicts };
  }

  const [reservation] = await tx
    .insert(inventoryReservations)
    .values({
      organizationId,
      pantryLocationId: appointment.pantryLocationId,
      appointmentId: appointment.id,
      householdId: appointment.householdId,
      status: "active",
      reservedBy: actorId,
      expiresAt: options.expiresAt ?? null,
      idempotencyKey: options.idempotencyKey,
    })
    .returning();

  for (const plan of planned) {
    const reservedTotal = plan.allocations.reduce((sum, allocationPlan) => sum + allocationPlan.quantity, 0);
    if (reservedTotal <= 0) continue; // optional line with nothing reservable
    const [line] = await tx
      .insert(inventoryReservationLines)
      .values({
        reservationId: reservation.id,
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        appointmentAllocationLineId: plan.allocationLine.inventoryItemId ? plan.allocationLine.id : null,
        inventoryItemId: plan.itemId,
        requestedBaseQuantity: fmtQ(plan.requested),
        reservedBaseQuantity: fmtQ(reservedTotal),
        isRequired: plan.allocationLine.isRequired,
      })
      .returning();
    for (const allocationPlan of plan.allocations) {
      await tx.insert(inventoryReservationLotAllocations).values({
        reservationLineId: line.id,
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        inventoryItemId: plan.itemId,
        inventoryLotId: allocationPlan.lotId,
        reservedBaseQuantity: fmtQ(allocationPlan.quantity),
      });
    }
  }

  await writeAudit(tx, actorId, organizationId, { action: "reservation.created", entityType: "inventory_reservation", entityId: reservation.id, locationId: appointment.pantryLocationId, requestId, newValues: { appointmentId: appointment.id, lineCount: planned.length, conflicts: conflicts.length } });
  return { reservation, conflicts };
}

export async function createReservation(actorId: string, organizationId: string, appointmentId: string, options: { expiresAt?: Date | null; idempotencyKey: string }, requestId: string) {
  return db.transaction(async (tx) => createReservationInTx(tx, actorId, organizationId, appointmentId, options, requestId));
}

async function releaseReservationInTx(tx: Transaction, actorId: string, organizationId: string, reservationId: string, reason: string, requestId: string, terminalStatus: "released" | "expired" | "cancelled" = "released") {
  const [reservation] = await tx
    .select()
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.id, reservationId), eq(inventoryReservations.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (!reservation) throw new DomainError("RESERVATION_NOT_FOUND");
  if (!["active", "partially_fulfilled"].includes(reservation.status)) return reservation;

  const lines = await tx.select().from(inventoryReservationLines).where(eq(inventoryReservationLines.reservationId, reservationId));
  for (const line of lines) {
    const remaining = Math.max(asQ(line.reservedBaseQuantity) - asQ(line.fulfilledBaseQuantity) - asQ(line.releasedBaseQuantity), 0);
    if (remaining > 0) {
      await tx.update(inventoryReservationLines).set({ releasedBaseQuantity: fmtQ(asQ(line.releasedBaseQuantity) + remaining) }).where(eq(inventoryReservationLines.id, line.id));
    }
    const lotAllocations = await tx.select().from(inventoryReservationLotAllocations).where(and(eq(inventoryReservationLotAllocations.reservationLineId, line.id), eq(inventoryReservationLotAllocations.status, "active")));
    for (const lotAllocation of lotAllocations) {
      const lotRemaining = Math.max(asQ(lotAllocation.reservedBaseQuantity) - asQ(lotAllocation.fulfilledBaseQuantity) - asQ(lotAllocation.releasedBaseQuantity), 0);
      await tx
        .update(inventoryReservationLotAllocations)
        .set({ releasedBaseQuantity: fmtQ(asQ(lotAllocation.releasedBaseQuantity) + lotRemaining), status: asQ(lotAllocation.fulfilledBaseQuantity) > 0 ? "fulfilled" : "released" })
        .where(eq(inventoryReservationLotAllocations.id, lotAllocation.id));
    }
  }
  const [updated] = await tx
    .update(inventoryReservations)
    .set({ status: terminalStatus, releasedAt: new Date(), releasedBy: actorId, releaseReason: reason })
    .where(eq(inventoryReservations.id, reservationId))
    .returning();
  await writeAudit(tx, actorId, organizationId, { action: `reservation.${terminalStatus}`, entityType: "inventory_reservation", entityId: reservationId, locationId: reservation.pantryLocationId, requestId, reason, previousValues: { status: reservation.status }, newValues: { status: terminalStatus } });
  return updated;
}

export async function releaseReservation(actorId: string, organizationId: string, reservationId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [reservation] = await tx.select({ pantryLocationId: inventoryReservations.pantryLocationId }).from(inventoryReservations).where(and(eq(inventoryReservations.id, reservationId), eq(inventoryReservations.organizationId, organizationId))).limit(1);
    if (!reservation) throw new DomainError("RESERVATION_NOT_FOUND");
    await requireLocationPermission(tx, actorId, reservation.pantryLocationId, "reservation.release");
    return releaseReservationInTx(tx, actorId, organizationId, reservationId, reason, requestId);
  });
}

/** Idempotent sweep marking due reservations expired and releasing their remaining quantities. */
export async function expireDueReservations(actorId: string, organizationId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: inventoryReservations.id })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.organizationId, organizationId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"]), sql`${inventoryReservations.expiresAt} is not null and ${inventoryReservations.expiresAt} <= now()`));
    for (const reservation of due) {
      await releaseReservationInTx(tx, actorId, organizationId, reservation.id, "Reservation expired", requestId, "expired");
    }
    return due.length;
  });
}

export async function substituteReservationItem(
  actorId: string,
  organizationId: string,
  reservationLineId: string,
  substituteItemId: string,
  reason: string,
  requestId: string,
) {
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(inventoryReservationLines).where(and(eq(inventoryReservationLines.id, reservationLineId), eq(inventoryReservationLines.organizationId, organizationId))).for("update").limit(1);
    if (!line) throw new DomainError("RESERVATION_NOT_FOUND");
    await requireLocationPermission(tx, actorId, line.pantryLocationId, "pickup.substitute");
    if (!line.isRequired && !line.appointmentAllocationLineId) throw new DomainError("SUBSTITUTION_NOT_ALLOWED");

    const [reservation] = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.id, line.reservationId)).for("update").limit(1);
    if (!reservation || !["active", "partially_fulfilled"].includes(reservation.status)) throw new DomainError("RESERVATION_INVALID_STATE");
    if (asQ(line.fulfilledBaseQuantity) > 0) throw new DomainError("RESERVATION_INVALID_STATE");

    const [substitute] = await tx
      .select({ id: inventoryItems.id, name: inventoryItems.name, status: inventoryItems.status, categoryName: sql<string | null>`(select name from inventory_categories c where c.id = ${inventoryItems.categoryId})` })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, substituteItemId), eq(inventoryItems.organizationId, organizationId)))
      .limit(1);
    if (!substitute || substitute.status !== "active") throw new DomainError("NOT_FOUND");

    // Critical dietary/allergen restrictions block the substitution.
    const restrictions = await tx
      .select({ valueCode: householdPreferences.valueCode, severity: householdPreferences.severity })
      .from(householdPreferences)
      .where(and(eq(householdPreferences.householdId, reservation.householdId), eq(householdPreferences.isActive, true), inArray(householdPreferences.preferenceType, ["dietary", "allergen"])));
    const conflict = substitutionConflicts(restrictions, `${substitute.name} ${substitute.categoryName ?? ""}`);
    if (conflict.blocked) throw new DomainError("SUBSTITUTION_DIETARY_CONFLICT");

    // Release the original line's remaining reservation.
    const remaining = Math.max(asQ(line.reservedBaseQuantity) - asQ(line.releasedBaseQuantity), 0);
    if (remaining <= 0) throw new DomainError("RESERVATION_INVALID_STATE");
    await tx.update(inventoryReservationLines).set({ releasedBaseQuantity: line.reservedBaseQuantity }).where(eq(inventoryReservationLines.id, line.id));
    const lotAllocations = await tx.select().from(inventoryReservationLotAllocations).where(and(eq(inventoryReservationLotAllocations.reservationLineId, line.id), eq(inventoryReservationLotAllocations.status, "active")));
    for (const lotAllocation of lotAllocations) {
      await tx.update(inventoryReservationLotAllocations).set({ releasedBaseQuantity: lotAllocation.reservedBaseQuantity, status: "released" }).where(eq(inventoryReservationLotAllocations.id, lotAllocation.id));
    }

    // Reserve the substitute with FEFO under lock.
    const lots = await lockAndComputeLotAvailability(tx, organizationId, line.pantryLocationId, substituteItemId);
    const plan = planFefoAllocation(
      lots.map((lot) => ({ lotId: lot.lot_id, expirationDate: lot.expiration_date, receivedDate: lot.received_date, availableQuantity: asQ(lot.available) })),
      remaining,
    );
    if (plan.shortage > 0) throw new DomainError("RESERVATION_INSUFFICIENT_STOCK");
    const [newLine] = await tx
      .insert(inventoryReservationLines)
      .values({
        reservationId: reservation.id,
        organizationId,
        pantryLocationId: line.pantryLocationId,
        inventoryItemId: substituteItemId,
        requestedBaseQuantity: fmtQ(remaining),
        reservedBaseQuantity: fmtQ(remaining),
        isRequired: line.isRequired,
      })
      .returning();
    for (const allocationPlan of plan.allocations) {
      await tx.insert(inventoryReservationLotAllocations).values({
        reservationLineId: newLine.id,
        organizationId,
        pantryLocationId: line.pantryLocationId,
        inventoryItemId: substituteItemId,
        inventoryLotId: allocationPlan.lotId,
        reservedBaseQuantity: fmtQ(allocationPlan.quantity),
      });
    }
    const [substitution] = await tx
      .insert(pickupSubstitutions)
      .values({
        organizationId,
        pantryLocationId: line.pantryLocationId,
        appointmentId: reservation.appointmentId,
        reservationId: reservation.id,
        reservationLineId: line.id,
        originalInventoryItemId: line.inventoryItemId,
        substituteInventoryItemId: substituteItemId,
        reason,
        createdBy: actorId,
      })
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "pickup.substitution_recorded", entityType: "pickup_substitution", entityId: substitution.id, locationId: line.pantryLocationId, requestId, reason, previousValues: { itemId: line.inventoryItemId }, newValues: { itemId: substituteItemId, quantity: fmtQ(remaining) } });
    return { substitution, newLine };
  });
}

// --- Check-in, fulfillment, cancellation ------------------------------------------

async function checkInInTx(tx: Transaction, actorId: string, organizationId: string, appointmentId: string, requestId: string) {
  const appointment = await lockAppointment(tx, organizationId, appointmentId);
  await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "appointment.check_in");
  if (appointment.status === "arrived") return appointment; // idempotent
  if (!checkInEligible(appointment.status)) throw new DomainError("APPOINTMENT_INVALID_STATE");
  const [updated] = await tx
    .update(appointments)
    .set({ status: "arrived", checkedInAt: new Date(), checkedInBy: actorId })
    .where(eq(appointments.id, appointmentId))
    .returning();
  await appendStatusHistory(tx, appointment, appointment.status, "arrived", actorId, "Checked in");
  await writeAudit(tx, actorId, organizationId, { action: "appointment.checked_in", entityType: "appointment", entityId: appointmentId, locationId: appointment.pantryLocationId, requestId, previousValues: { status: appointment.status }, newValues: { status: "arrived" } });
  return updated;
}

export async function checkInAppointment(actorId: string, organizationId: string, appointmentId: string, requestId: string) {
  return db.transaction(async (tx) => checkInInTx(tx, actorId, organizationId, appointmentId, requestId));
}

export type FulfillmentLineInput = { reservationLineId: string; inventoryLotId: string; quantity: number };

export async function completePickup(
  actorId: string,
  organizationId: string,
  appointmentId: string,
  values: { lines: FulfillmentLineInput[]; notes?: string | null; idempotencyKey: string },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, organizationId, appointmentId);
    await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "pickup.complete");

    const [existing] = await tx
      .select()
      .from(pickupFulfillments)
      .where(and(eq(pickupFulfillments.organizationId, organizationId), eq(pickupFulfillments.idempotencyKey, values.idempotencyKey)))
      .limit(1);
    if (existing) return { fulfillment: existing, duplicate: true as const };

    if (appointment.status === "completed") throw new DomainError("FULFILLMENT_ALREADY_COMPLETED");
    if (appointment.status !== "arrived" && appointment.status !== "partially_completed") throw new DomainError("APPOINTMENT_INVALID_STATE");

    const [reservation] = await tx
      .select()
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.appointmentId, appointmentId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"])))
      .for("update")
      .limit(1);
    if (!reservation) throw new DomainError("RESERVATION_NOT_FOUND");
    const membershipId = await actorMembership(tx, actorId, organizationId);

    const [fulfillment] = await tx
      .insert(pickupFulfillments)
      .values({
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        appointmentId,
        householdId: appointment.householdId,
        reservationId: reservation.id,
        status: "draft",
        idempotencyKey: values.idempotencyKey,
        notes: values.notes || null,
        createdBy: actorId,
      })
      .returning();

    let anyFulfilled = false;
    for (const input of values.lines) {
      if (!(input.quantity > 0)) throw new DomainError("INVALID_QUANTITY");
      const [line] = await tx.select().from(inventoryReservationLines).where(and(eq(inventoryReservationLines.id, input.reservationLineId), eq(inventoryReservationLines.reservationId, reservation.id))).for("update").limit(1);
      if (!line) throw new DomainError("RESERVATION_NOT_FOUND");
      const [lotAllocation] = await tx
        .select()
        .from(inventoryReservationLotAllocations)
        .where(and(eq(inventoryReservationLotAllocations.reservationLineId, line.id), eq(inventoryReservationLotAllocations.inventoryLotId, input.inventoryLotId), eq(inventoryReservationLotAllocations.status, "active")))
        .for("update")
        .limit(1);
      if (!lotAllocation) throw new DomainError("RESERVATION_NOT_FOUND");
      const lotRemaining = asQ(lotAllocation.reservedBaseQuantity) - asQ(lotAllocation.fulfilledBaseQuantity) - asQ(lotAllocation.releasedBaseQuantity);
      if (input.quantity > lotRemaining + 1e-9) throw new DomainError("FULFILLMENT_EXCEEDS_RESERVATION");

      // Post the immutable physical consumption; the ledger trigger enforces negative-stock protection.
      const transaction = await postInventoryTransaction(tx, {
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        inventoryItemId: line.inventoryItemId,
        inventoryLotId: input.inventoryLotId,
        transactionType: "pickup_fulfillment",
        physicalDelta: `-${fmtQ(input.quantity)}`,
        reasonCode: "pickup_fulfillment",
        reason: `Pickup ${appointment.appointmentNumber}`,
        correlationId: fulfillment.id,
        sourceType: "pickup_fulfillment",
        sourceReferenceId: fulfillment.id,
        sourceReference: appointment.appointmentNumber,
        actorUserId: actorId,
        actorMembershipId: membershipId,
        requestId,
      });
      await tx.insert(pickupFulfillmentLines).values({
        pickupFulfillmentId: fulfillment.id,
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        reservationLineId: line.id,
        inventoryItemId: line.inventoryItemId,
        inventoryLotId: input.inventoryLotId,
        fulfilledBaseQuantity: fmtQ(input.quantity),
        inventoryTransactionId: transaction.id,
      });
      const newLotFulfilled = asQ(lotAllocation.fulfilledBaseQuantity) + input.quantity;
      const exhausted = newLotFulfilled + asQ(lotAllocation.releasedBaseQuantity) >= asQ(lotAllocation.reservedBaseQuantity) - 1e-9;
      await tx
        .update(inventoryReservationLotAllocations)
        .set({ fulfilledBaseQuantity: fmtQ(newLotFulfilled), status: exhausted ? "fulfilled" : "active" })
        .where(eq(inventoryReservationLotAllocations.id, lotAllocation.id));
      await tx
        .update(inventoryReservationLines)
        .set({ fulfilledBaseQuantity: fmtQ(asQ(line.fulfilledBaseQuantity) + input.quantity) })
        .where(eq(inventoryReservationLines.id, line.id));
      anyFulfilled = true;
    }

    // Release every remaining reserved quantity; only physically provided food posts to the ledger.
    const lines = await tx.select().from(inventoryReservationLines).where(eq(inventoryReservationLines.reservationId, reservation.id));
    let allRequiredFullyFulfilled = true;
    for (const line of lines) {
      const remaining = Math.max(asQ(line.reservedBaseQuantity) - asQ(line.fulfilledBaseQuantity) - asQ(line.releasedBaseQuantity), 0);
      if (remaining > 0) {
        await tx.update(inventoryReservationLines).set({ releasedBaseQuantity: fmtQ(asQ(line.releasedBaseQuantity) + remaining) }).where(eq(inventoryReservationLines.id, line.id));
      }
      if (line.isRequired && asQ(line.fulfilledBaseQuantity) + 1e-9 < asQ(line.reservedBaseQuantity)) allRequiredFullyFulfilled = false;
      const lotAllocations = await tx.select().from(inventoryReservationLotAllocations).where(and(eq(inventoryReservationLotAllocations.reservationLineId, line.id), eq(inventoryReservationLotAllocations.status, "active")));
      for (const lotAllocation of lotAllocations) {
        const lotRemaining = Math.max(asQ(lotAllocation.reservedBaseQuantity) - asQ(lotAllocation.fulfilledBaseQuantity) - asQ(lotAllocation.releasedBaseQuantity), 0);
        await tx
          .update(inventoryReservationLotAllocations)
          .set({ releasedBaseQuantity: fmtQ(asQ(lotAllocation.releasedBaseQuantity) + lotRemaining), status: asQ(lotAllocation.fulfilledBaseQuantity) > 0 ? "fulfilled" : "released" })
          .where(eq(inventoryReservationLotAllocations.id, lotAllocation.id));
      }
    }

    const fulfillmentStatusValue = allRequiredFullyFulfilled && anyFulfilled ? "completed" : anyFulfilled ? "partially_completed" : "completed";
    const appointmentStatusValue: AppointmentStatus = allRequiredFullyFulfilled && anyFulfilled ? "completed" : anyFulfilled ? "partially_completed" : "completed";
    if (!canTransitionAppointment(appointment.status as AppointmentStatus, appointmentStatusValue)) throw new DomainError("APPOINTMENT_INVALID_STATE");

    await tx
      .update(inventoryReservations)
      .set({ status: anyFulfilled ? "fulfilled" : "released", fulfilledAt: anyFulfilled ? new Date() : null, releasedAt: new Date(), releasedBy: actorId, releaseReason: anyFulfilled ? "Completed pickup" : "Completed with nothing fulfilled" })
      .where(eq(inventoryReservations.id, reservation.id));
    const [completedFulfillment] = await tx
      .update(pickupFulfillments)
      .set({ status: fulfillmentStatusValue, completedBy: actorId, completedAt: new Date() })
      .where(eq(pickupFulfillments.id, fulfillment.id))
      .returning();
    await tx
      .update(appointments)
      .set({ status: appointmentStatusValue, completedAt: new Date(), completedBy: actorId })
      .where(eq(appointments.id, appointmentId));
    await appendStatusHistory(tx, appointment, appointment.status, appointmentStatusValue, actorId, "Pickup completed");
    await writeAudit(tx, actorId, organizationId, { action: "pickup.completed", entityType: "pickup_fulfillment", entityId: fulfillment.id, locationId: appointment.pantryLocationId, requestId, newValues: { appointmentId, status: fulfillmentStatusValue, lineCount: values.lines.length } });
    return { fulfillment: completedFulfillment, duplicate: false as const };
  });
}

export async function cancelAppointment(actorId: string, organizationId: string, appointmentId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, organizationId, appointmentId);
    await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "appointment.cancel");
    if (!cancellationEligible(appointment.status)) throw new DomainError("APPOINTMENT_INVALID_STATE");

    const [reservation] = await tx
      .select({ id: inventoryReservations.id })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.appointmentId, appointmentId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"])))
      .limit(1);
    if (reservation) await releaseReservationInTx(tx, actorId, organizationId, reservation.id, `Appointment cancelled: ${reason}`, requestId, "cancelled");

    const [updated] = await tx
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actorId, cancellationReason: reason })
      .where(eq(appointments.id, appointmentId))
      .returning();
    await appendStatusHistory(tx, appointment, appointment.status, "cancelled", actorId, reason);
    await writeAudit(tx, actorId, organizationId, { action: "appointment.cancelled", entityType: "appointment", entityId: appointmentId, locationId: appointment.pantryLocationId, requestId, reason, previousValues: { status: appointment.status }, newValues: { status: "cancelled" } });
    return updated;
  });
}

export async function markNoShow(actorId: string, organizationId: string, appointmentId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, organizationId, appointmentId);
    await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "appointment.mark_no_show");
    if (appointment.status === "no_show") return appointment; // idempotent
    if (!noShowEligible(appointment.status as AppointmentStatus, appointment.scheduledEndAt)) throw new DomainError("APPOINTMENT_INVALID_STATE");

    const [reservation] = await tx
      .select({ id: inventoryReservations.id })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.appointmentId, appointmentId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"])))
      .limit(1);
    if (reservation) await releaseReservationInTx(tx, actorId, organizationId, reservation.id, "Appointment no-show", requestId, "released");

    const [updated] = await tx
      .update(appointments)
      .set({ status: "no_show", noShowAt: new Date(), noShowBy: actorId })
      .where(eq(appointments.id, appointmentId))
      .returning();
    await appendStatusHistory(tx, appointment, appointment.status, "no_show", actorId, reason);
    await writeAudit(tx, actorId, organizationId, { action: "appointment.no_show", entityType: "appointment", entityId: appointmentId, locationId: appointment.pantryLocationId, requestId, reason, previousValues: { status: appointment.status }, newValues: { status: "no_show" } });
    return updated;
  });
}

export async function rescheduleAppointment(
  actorId: string,
  organizationId: string,
  appointmentId: string,
  values: { scheduledStartAt: Date; scheduledEndAt: Date; reserve?: boolean },
  requestId: string,
) {
  return db.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, organizationId, appointmentId);
    await requireLocationPermission(tx, actorId, appointment.pantryLocationId, "appointment.reschedule");
    if (!rescheduleEligible(appointment.status as AppointmentStatus)) throw new DomainError("APPOINTMENT_INVALID_STATE");
    if (values.scheduledStartAt >= values.scheduledEndAt) throw new DomainError("APPOINTMENT_TIME_INVALID");

    const [reservation] = await tx
      .select({ id: inventoryReservations.id })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.appointmentId, appointmentId), inArray(inventoryReservations.status, ["active", "partially_fulfilled"])))
      .limit(1);
    if (reservation) await releaseReservationInTx(tx, actorId, organizationId, reservation.id, "Appointment rescheduled", requestId, "released");

    const [replacement] = await tx
      .insert(appointments)
      .values({
        organizationId,
        pantryLocationId: appointment.pantryLocationId,
        householdId: appointment.householdId,
        appointmentNumber: referenceNumber("A"),
        appointmentType: appointment.appointmentType,
        status: "scheduled",
        scheduledStartAt: values.scheduledStartAt,
        scheduledEndAt: values.scheduledEndAt,
        packageTemplateId: appointment.packageTemplateId,
        householdSizeSnapshot: appointment.householdSizeSnapshot,
        preferredLanguageSnapshot: appointment.preferredLanguageSnapshot,
        specialInstructions: appointment.specialInstructions,
        rescheduledFromAppointmentId: appointment.id,
        createdBy: actorId,
      })
      .returning();
    await appendStatusHistory(tx, replacement, null, "scheduled", actorId, `Rescheduled from ${appointment.appointmentNumber}`);
    const [original] = await tx
      .update(appointments)
      .set({ status: "rescheduled", rescheduledToAppointmentId: replacement.id })
      .where(eq(appointments.id, appointmentId))
      .returning();
    await appendStatusHistory(tx, appointment, appointment.status, "rescheduled", actorId, `Rescheduled to ${replacement.appointmentNumber}`);
    await writeAudit(tx, actorId, organizationId, { action: "appointment.rescheduled", entityType: "appointment", entityId: appointmentId, locationId: appointment.pantryLocationId, requestId, previousValues: { startAt: appointment.scheduledStartAt.toISOString() }, newValues: { replacementAppointmentId: replacement.id, startAt: values.scheduledStartAt.toISOString() } });

    if (appointment.packageTemplateId) {
      await generateAllocationInTx(tx, actorId, organizationId, replacement.id, requestId);
    }
    let reservationResult: Awaited<ReturnType<typeof createReservationInTx>> | null = null;
    if (values.reserve !== false && appointment.packageTemplateId) {
      reservationResult = await createReservationInTx(tx, actorId, organizationId, replacement.id, { idempotencyKey: crypto.randomUUID() }, requestId);
    }
    return { original, replacement, reservation: reservationResult };
  });
}

/**
 * Controlled correction: reverses every ledger transaction the fulfillment posted and marks the
 * fulfillment corrected. Recording replacement quantities happens through a new fulfillment; the
 * original record and its transactions remain visible forever.
 */
export async function correctPickupFulfillment(actorId: string, organizationId: string, fulfillmentId: string, reason: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [fulfillment] = await tx
      .select()
      .from(pickupFulfillments)
      .where(and(eq(pickupFulfillments.id, fulfillmentId), eq(pickupFulfillments.organizationId, organizationId)))
      .for("update")
      .limit(1);
    if (!fulfillment) throw new DomainError("NOT_FOUND");
    await requireLocationPermission(tx, actorId, fulfillment.pantryLocationId, "pickup.correct");
    if (fulfillment.status === "corrected") return fulfillment; // idempotent
    if (fulfillment.status !== "completed" && fulfillment.status !== "partially_completed") throw new DomainError("FULFILLMENT_IMMUTABLE");
    const membershipId = await actorMembership(tx, actorId, organizationId);

    const lines = await tx.select().from(pickupFulfillmentLines).where(eq(pickupFulfillmentLines.pickupFulfillmentId, fulfillmentId));
    for (const line of lines) {
      if (!line.inventoryTransactionId) continue;
      await reverseInventoryTransaction(tx, {
        transactionId: line.inventoryTransactionId,
        organizationId,
        actorUserId: actorId,
        actorMembershipId: membershipId,
        requestId,
        reason: `Pickup correction: ${reason}`,
        correlationId: fulfillment.id,
      });
    }
    const [corrected] = await tx
      .update(pickupFulfillments)
      .set({ status: "corrected", correctionReason: reason })
      .where(eq(pickupFulfillments.id, fulfillmentId))
      .returning();
    await writeAudit(tx, actorId, organizationId, { action: "pickup.corrected", entityType: "pickup_fulfillment", entityId: fulfillmentId, locationId: fulfillment.pantryLocationId, requestId, reason, previousValues: { status: fulfillment.status }, newValues: { status: "corrected", reversedLines: lines.length } });
    return corrected;
  });
}
