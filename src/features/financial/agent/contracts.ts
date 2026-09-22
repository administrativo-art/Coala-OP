import { z } from "zod";
import { stoneAgendaQuerySchema } from "@/lib/integrations/stone/agenda-query";

export const financialAgentIdentifier = z.string().trim().min(1).max(180)
  .refine(value => !value.includes("/") && value !== "." && value !== "..");
export const financialAgentRequestSchema = stoneAgendaQuerySchema.pick({ stoneCode: true, referenceDate: true }).extend({
  intent: z.literal("review_anticipations"),
  kioskId: financialAgentIdentifier,
  // Explicit opt-in; reads and calculations do not require a model.
  prioritizeWithAi: z.boolean().default(false),
}).strict();
export type FinancialAgentRequest = z.infer<typeof financialAgentRequestSchema>;

// Read projection of the existing stoneMerchantMappings contract, not a second registry.
export const financialAgentMappingSchema = z.object({
  id: financialAgentIdentifier,
  workspaceId: financialAgentIdentifier,
  kioskId: financialAgentIdentifier,
  accountId: financialAgentIdentifier,
  stoneCodes: z.array(stoneAgendaQuerySchema.shape.stoneCode).min(1).max(20),
  terminalIds: z.array(z.string().min(1).max(100)).max(100),
  status: z.enum(["active", "inactive"]),
  validFrom: stoneAgendaQuerySchema.shape.referenceDate,
  validTo: stoneAgendaQuerySchema.shape.referenceDate.nullish(),
}).refine(value => !value.validTo || value.validTo >= value.validFrom);
export type FinancialAgentMapping = z.infer<typeof financialAgentMappingSchema>;

export const financialActionIdSchema = z.enum([
  "check_origins", "check_fees", "check_residual", "reconcile_bank", "read_full_portfolio",
]);
export const financialAgentPrioritySchema = z.object({
  orderedActionIds: z.array(financialActionIdSchema).max(5),
}).strict();
export type FinancialActionId = z.infer<typeof financialActionIdSchema>;
