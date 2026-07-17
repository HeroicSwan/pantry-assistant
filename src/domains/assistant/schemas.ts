import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().uuid();

// --- Read tool inputs ---

export const inventorySummaryInputSchema = z.object({ categoryId: uuid.optional() }).strict();

export const searchInventoryItemsInputSchema = z.object({ query: z.string().trim().min(1).max(80) }).strict();

export const inventoryItemDetailsInputSchema = z.object({ itemId: uuid }).strict();

export const inventoryLotHistoryInputSchema = z.object({ lotId: uuid }).strict();

export const inventoryTransactionHistoryInputSchema = z
  .object({ itemId: uuid, days: z.number().int().min(1).max(90).default(14) })
  .strict();

export const shortageForecastInputSchema = z
  .object({ horizonDays: z.number().int().min(1).max(90).default(30) })
  .strict();

export const categoryForecastInputSchema = z
  .object({ horizonDays: z.number().int().min(1).max(90).default(30) })
  .strict();

export const expiringInventoryInputSchema = z
  .object({ withinDays: z.number().int().min(1).max(90).default(7) })
  .strict();

export const activeAlertsInputSchema = z
  .object({
    severity: z.enum(["info", "warning", "critical"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const upcomingAppointmentsInputSchema = z
  .object({ withinDays: z.number().int().min(1).max(30).default(3) })
  .strict();

export const pickupCountsInputSchema = z.object({ days: z.number().int().min(1).max(90).default(7) }).strict();

export const householdPickupStatusInputSchema = z.object({ householdId: uuid }).strict();

export const smsDeliverySummaryInputSchema = z.object({ days: z.number().int().min(1).max(90).default(7) }).strict();

export const recentDonationsInputSchema = z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict();

export const operationalMetricsInputSchema = z.object({}).strict();

// --- Proposal tool inputs ---

export const acknowledgeAlertProposalInputSchema = z
  .object({
    alertId: uuid,
    reason: z.string().trim().min(3).max(500),
    idempotencyKey,
  })
  .strict();

export const draftSmsMessageInputSchema = z
  .object({
    body: z.string().trim().min(3).max(480),
    purpose: z.string().trim().max(200).optional(),
    idempotencyKey,
  })
  .strict();

export const draftBulkAnnouncementInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    body: z.string().trim().min(3).max(480),
    idempotencyKey,
  })
  .strict();

// unitId is deliberately not accepted here: the base unit is always resolved server-side from
// the lot's item, so neither a user-facing form nor the model can select an ambiguous or
// mismatched unit for the quantity.
export const inventoryAdjustmentProposalInputSchema = z
  .object({
    lotId: uuid,
    direction: z.enum(["positive", "negative"]),
    quantity: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,6})?$/, "Enter a positive quantity."),
    reasonCode: z.string().trim().min(1).max(60),
    reason: z.string().trim().min(3).max(280),
    idempotencyKey,
  })
  .strict();

export const reservationProposalInputSchema = z
  .object({ appointmentId: uuid, idempotencyKey })
  .strict();

export const donationNeedsReportInputSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(90).default(30),
    idempotencyKey,
  })
  .strict();

export const pickupRescheduleProposalInputSchema = z
  .object({
    appointmentId: uuid,
    scheduledStartAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    scheduledEndAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    idempotencyKey,
  })
  .strict()
  .refine((value) => new Date(value.scheduledStartAt) < new Date(value.scheduledEndAt), {
    message: "The start time must be before the end time.",
    path: ["scheduledEndAt"],
  });

export const assistantPromptSchema = z.string().trim().min(2).max(1_000);

export const conversationTitleSchema = z.string().trim().min(2).max(120);

export const proposalIdSchema = z.string().uuid();

export type InventorySummaryInput = z.infer<typeof inventorySummaryInputSchema>;
export type SearchInventoryItemsInput = z.infer<typeof searchInventoryItemsInputSchema>;
export type InventoryItemDetailsInput = z.infer<typeof inventoryItemDetailsInputSchema>;
export type InventoryLotHistoryInput = z.infer<typeof inventoryLotHistoryInputSchema>;
export type InventoryTransactionHistoryInput = z.infer<typeof inventoryTransactionHistoryInputSchema>;
export type ShortageForecastInput = z.infer<typeof shortageForecastInputSchema>;
export type CategoryForecastInput = z.infer<typeof categoryForecastInputSchema>;
export type ExpiringInventoryInput = z.infer<typeof expiringInventoryInputSchema>;
export type ActiveAlertsInput = z.infer<typeof activeAlertsInputSchema>;
export type UpcomingAppointmentsInput = z.infer<typeof upcomingAppointmentsInputSchema>;
export type PickupCountsInput = z.infer<typeof pickupCountsInputSchema>;
export type HouseholdPickupStatusInput = z.infer<typeof householdPickupStatusInputSchema>;
export type SmsDeliverySummaryInput = z.infer<typeof smsDeliverySummaryInputSchema>;
export type RecentDonationsInput = z.infer<typeof recentDonationsInputSchema>;
export type OperationalMetricsInput = z.infer<typeof operationalMetricsInputSchema>;
export type AcknowledgeAlertProposalInput = z.infer<typeof acknowledgeAlertProposalInputSchema>;
export type DraftSmsMessageInput = z.infer<typeof draftSmsMessageInputSchema>;
export type DraftBulkAnnouncementInput = z.infer<typeof draftBulkAnnouncementInputSchema>;
export type InventoryAdjustmentProposalInput = z.infer<typeof inventoryAdjustmentProposalInputSchema>;
export type ReservationProposalInput = z.infer<typeof reservationProposalInputSchema>;
export type DonationNeedsReportInput = z.infer<typeof donationNeedsReportInputSchema>;
export type PickupRescheduleProposalInput = z.infer<typeof pickupRescheduleProposalInputSchema>;
