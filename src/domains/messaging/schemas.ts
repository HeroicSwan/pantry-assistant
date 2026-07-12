import { z } from "zod";

export const messageTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  templateType: z.string().trim().min(2).max(80),
  language: z.string().trim().min(2).max(12),
  body: z.string().trim().min(1).max(1600),
});

export const individualMessageSchema = z.object({
  contactId: z.string().uuid(),
  body: z.string().trim().min(1).max(1600),
  language: z.string().trim().min(2).max(12).default("en"),
  scheduledFor: z.string().optional(),
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal("yes"),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  campaignType: z.string().trim().min(2).max(80).default("bulk_announcement"),
  body: z.string().trim().min(1).max(1600),
  appointmentDate: z.string().optional(),
  appointmentStatus: z.string().optional(),
  preferredLanguage: z.string().optional(),
  scheduledFor: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

export const messagingSettingsSchema = z.object({
  sendingMode: z.enum(["disabled", "simulation", "twilio_test", "live"]),
  defaultFromNumber: z.string().trim().max(32).optional(),
  defaultLanguage: z.string().trim().min(2).max(12),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  reminderHoursBefore: z.coerce.number().int().min(1).max(168),
  retryLimit: z.coerce.number().int().min(0).max(10),
  helpResponse: z.string().trim().min(10).max(320),
  isEnabled: z.boolean(),
  confirmLive: z.boolean(),
});
