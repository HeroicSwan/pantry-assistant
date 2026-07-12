import { z } from "zod";
import { optionalText, slugSchema } from "@/lib/validation";

const uuid = z.string().uuid();

// Positive decimal quantity kept as a string for exact base-unit conversion.
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Enter a positive number.")
  .refine((value) => Number(value) > 0, "Enter a quantity greater than zero.")
  .refine((value) => (value.split(".")[1]?.length ?? 0) <= 6, "Use at most six decimal places.");

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional()
  .or(z.literal(""));

export const unitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  abbreviation: z.string().trim().min(1).max(16),
  dimension: z.enum(["count", "mass", "volume"]),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema.optional().or(z.literal("")),
  description: optionalText(280),
});

export const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: optionalText(60),
  categoryId: uuid.optional().or(z.literal("")),
  baseUnitId: uuid,
  tracksExpiration: z.union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")]).optional(),
  notes: optionalText(500),
});

export const itemUnitSchema = z.object({
  itemId: uuid,
  unitId: uuid,
  factor: quantitySchema,
  roundingPolicy: z.enum(["reject", "floor", "ceiling", "half_up"]),
});

export const storageLocationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: optionalText(40),
  notes: optionalText(280),
});

export const lotSchema = z.object({
  itemId: uuid,
  storageLocationId: uuid.optional().or(z.literal("")),
  lotCode: optionalText(80),
  receivedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  bestByDate: optionalDate,
  useByDate: optionalDate,
  expirationDate: optionalDate,
  notes: optionalText(280),
  openingQuantity: quantitySchema.optional().or(z.literal("")),
  openingUnitId: uuid.optional().or(z.literal("")),
});

export const adjustmentSchema = z.object({
  lotId: uuid,
  direction: z.enum(["positive", "negative"]),
  quantity: quantitySchema,
  unitId: uuid,
  reasonCode: z.enum([
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
  ]),
  reason: z.string().trim().min(3).max(280),
});

export const reversalSchema = z.object({
  transactionId: uuid,
  reason: z.string().trim().min(3).max(280),
});

export function parseCheckbox(value: FormDataEntryValue | null | undefined): boolean {
  return value === "on" || value === "true";
}
