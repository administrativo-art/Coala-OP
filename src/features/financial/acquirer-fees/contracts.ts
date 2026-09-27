import { z } from "zod";
import { salesReviewRequestSchema } from "../sales-reconciliation/query";
import { financialAgentIdentifier } from "../agent/contracts";

export const feeRequestSchema = salesReviewRequestSchema.extend({ source: z.enum(["pix", "cards"]) }).strict();
export type FeeRequest = z.infer<typeof feeRequestSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(3).max(500);
export const feeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), request: feeRequestSchema }).strict(),
  z.object({ action: z.literal("create"), request: feeRequestSchema, batchId: hash, fingerprint: hash,
    accountPlanId: financialAgentIdentifier, resultCenterId: financialAgentIdentifier,
    confirmedNoManualExpense: z.literal(true), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("link"), request: feeRequestSchema, batchId: hash, fingerprint: hash,
    existingExpenseId: financialAgentIdentifier, reason: reason.optional() }).strict(),
  z.object({ action: z.literal("cancel"), request: feeRequestSchema, batchId: hash, reason }).strict(),
]);
export type FeeAction = z.infer<typeof feeActionSchema>;
export type FeeKind = "pix" | "mdr" | "anticipation";
export const FEE_LABELS: Record<FeeKind, string> = { pix: "Taxa Pix", mdr: "Taxa de cartão (MDR)", anticipation: "Custo de antecipação" };
export type FeeComponent = {
  id: string; kind: FeeKind; amountDecimal: string; competenceDate: string; settledOn: string;
  evidence: { transactionId: string; installment: number; paymentId: string; gross: string; net: string; originalNet: string | null };
};
export type FeeBatch = { id: string; fingerprint: string; kind: FeeKind; competenceDate: string; settledOn: string;
  amountCents: number; members: FeeComponent[] };
export type FeeRecordView = { id: string; expenseId: string; active: boolean; revision: number; fingerprint: string;
  kind: FeeKind; amountCents: number; competenceDate: string; settledOn: string; createdExpense: boolean };
export type FeePreview = { request: FeeRequest; batches: FeeBatch[]; pending: string[]; records: FeeRecordView[] };
