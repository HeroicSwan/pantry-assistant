import { z } from "zod";
import {
  localeSchema,
  optionalText,
  slugSchema,
  timeZoneSchema,
} from "@/lib/validation";

const contactFields = {
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

export const onboardingSchema = z.object({
  idempotencyKey: z.uuid(),
  profile: z.object({
    displayName: z.string().trim().min(2).max(100),
    firstName: optionalText(80),
    lastName: optionalText(80),
    preferredLocale: localeSchema,
  }),
  organization: z.object({
    name: z.string().trim().min(2).max(160),
    slug: slugSchema,
    timezone: timeZoneSchema,
    defaultLocale: localeSchema,
    ...contactFields,
  }),
  location: z.object({
    name: z.string().trim().min(2).max(160),
    slug: slugSchema,
    timezone: timeZoneSchema.optional().or(z.literal("")),
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
    operatingNotes: optionalText(500),
  }),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
