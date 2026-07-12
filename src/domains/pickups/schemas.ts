import { z } from "zod";
import { optionalText } from "@/lib/validation";

const uuid = z.string().uuid();

const positiveInt = z.coerce.number().int().min(1).max(50);
const optionalCount = z
  .string()
  .trim()
  .regex(/^\d*$/, "Enter a whole number.")
  .optional()
  .or(z.literal(""));

export const householdSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  preferredLanguage: z.string().trim().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, "Use a locale code such as en or es.").optional().or(z.literal("")),
  householdSize: positiveInt,
  adultCount: optionalCount,
  childCount: optionalCount,
  seniorCount: optionalCount,
  defaultPantryLocationId: uuid.optional().or(z.literal("")),
  operationalNotes: optionalText(500),
  externalReference: optionalText(80),
});

export const contactSchema = z.object({
  householdId: uuid,
  contactType: z.enum(["primary", "alternate", "emergency", "caregiver", "authorized_pickup"]),
  name: z.string().trim().min(2).max(120),
  relationshipLabel: optionalText(60),
  phoneNumber: optionalText(30),
  email: optionalText(120),
  isAuthorizedPickup: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const preferenceSchema = z.object({
  householdId: uuid,
  preferenceType: z.enum(["dietary", "allergen", "accessibility", "pickup"]),
  valueCode: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Use lowercase words with underscores."),
  displayLabel: z.string().trim().min(2).max(80),
  severity: z.enum(["info", "warning", "critical"]),
  notes: optionalText(280),
});

export const consentSchema = z.object({
  householdId: uuid,
  householdContactId: uuid.optional().or(z.literal("")),
  phoneNumber: z.string().trim().min(7).max(30),
  status: z.enum(["consented", "opted_out", "revoked", "unknown", "invalid_number"]),
  consentSource: z.enum(["paper_form", "verbal", "web_form", "inbound_start", "imported", "administrative_correction"]),
  notes: optionalText(280),
});

export const packageTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(280),
  packageType: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Use lowercase words with underscores."),
  allowSubstitutions: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const packageLineSchema = z.object({
  templateId: uuid,
  lineType: z.enum(["exact_item", "category_choice", "optional_item"]),
  inventoryItemId: uuid.optional().or(z.literal("")),
  inventoryCategoryId: uuid.optional().or(z.literal("")),
  baseQuantity: z.string().trim().regex(/^\d+(\.\d{1,6})?$/, "Enter a positive quantity."),
  isRequired: z.union([z.literal("on"), z.literal("")]).optional(),
  allowSubstitution: z.union([z.literal("on"), z.literal("")]).optional(),
  priority: z.coerce.number().int().min(1).max(999).default(100),
});

export const sizeRuleSchema = z.object({
  templateId: uuid,
  minimumHouseholdSize: positiveInt,
  maximumHouseholdSize: optionalCount,
  quantityMultiplier: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Enter a positive multiplier."),
});

export const appointmentSchema = z.object({
  householdId: uuid,
  appointmentType: z.enum(["scheduled_pickup", "recurring_pickup", "walk_in", "emergency_pickup", "special_distribution"]),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
  packageTemplateId: uuid.optional().or(z.literal("")),
  specialInstructions: optionalText(280),
  reserve: z.union([z.literal("on"), z.literal("")]).optional(),
  walkInCheckIn: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const rescheduleSchema = z.object({
  appointmentId: uuid,
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(280),
});

export const substitutionSchema = z.object({
  reservationLineId: uuid,
  substituteItemId: uuid,
  reason: z.string().trim().min(3).max(280),
});

export const fulfillmentLineSchema = z.object({
  reservationLineId: uuid,
  inventoryLotId: uuid,
  quantity: z.coerce.number().positive().max(1_000_000),
});

export function parseOn(value: FormDataEntryValue | null | undefined): boolean {
  return value === "on";
}

export function parseOptionalCount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
