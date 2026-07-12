import { z } from "zod";

export const inventorySummaryInputSchema = z
  .object({ categoryId: z.string().uuid().optional() })
  .strict();

export const shortageForecastInputSchema = z
  .object({ horizonDays: z.number().int().min(1).max(90).default(30) })
  .strict();

export const activeAlertsInputSchema = z
  .object({
    severity: z.enum(["info", "warning", "critical"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const acknowledgeAlertProposalInputSchema = z
  .object({
    alertId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const assistantPromptSchema = z.string().trim().min(2).max(1_000);

export const conversationTitleSchema = z.string().trim().min(2).max(120);

export const proposalIdSchema = z.string().uuid();

export type InventorySummaryInput = z.infer<typeof inventorySummaryInputSchema>;
export type ShortageForecastInput = z.infer<typeof shortageForecastInputSchema>;
export type ActiveAlertsInput = z.infer<typeof activeAlertsInputSchema>;
export type AcknowledgeAlertProposalInput = z.infer<
  typeof acknowledgeAlertProposalInputSchema
>;
