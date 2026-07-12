import { z } from "zod";
import {
  localeSchema,
  optionalText,
  slugSchema,
  timeZoneSchema,
} from "@/lib/validation";

const contactSchema = {
  email: z.email().trim().optional().or(z.literal("")),
  phoneNumber: optionalText(30),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(100),
  stateRegion: optionalText(100),
  postalCode: optionalText(30),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
};

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  firstName: optionalText(80),
  lastName: optionalText(80),
  phoneNumber: optionalText(30),
  preferredLocale: localeSchema,
});

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2).max(160),
  timezone: timeZoneSchema,
  defaultLocale: localeSchema,
  ...contactSchema,
});

export const locationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slugSchema.optional(),
  status: z.enum(["active", "temporarily_closed"]).default("active"),
  timezone: timeZoneSchema.optional().or(z.literal("")),
  operatingNotes: optionalText(500),
  ...contactSchema,
});

export const invitationSchema = z.object({
  email: z.email().trim(),
  roleId: z.uuid(),
  locationId: z.uuid().optional().or(z.literal("")),
});

export const roleAssignmentSchema = z.object({
  membershipId: z.uuid(),
  roleId: z.uuid(),
  locationId: z.uuid().optional().or(z.literal("")),
  expiresAt: z.iso.datetime().optional().or(z.literal("")),
});

export const locationAssignmentSchema = z.object({
  membershipId: z.uuid(),
  locationId: z.uuid(),
});
