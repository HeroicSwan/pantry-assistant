import { z } from "zod";

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

export function normalizeSlug(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Select a timezone.")
  .max(100)
  .refine(isValidTimeZone, "Select a valid IANA timezone.");

export const localeSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);

export const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().or(z.literal(""));
