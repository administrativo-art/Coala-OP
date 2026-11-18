import { z } from "zod";
import { feeRequestSchema, type FeeKind } from "./contracts";
const id = z.string().trim().min(1).max(180).regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const feeRateContractSchema = z.object({ id, version: z.number().int().positive(), approvedAt: z.string().datetime(), validFrom: date, validThrough: date.nullable(),
  source: z.enum(["pix", "cards"]), brandCode: z.string().max(20).nullable(), accountTypeCode: z.string().max(20).nullable(),
  minInstallments: z.number().int().min(1).max(99), maxInstallments: z.number().int().min(1).max(99),
  rateBasisPoints: z.number().int().min(0).max(10000), fixedCents: z.number().int().min(0).max(100000), rounding: z.enum(["round", "floor"]),
}).strict().refine(c => c.minInstallments <= c.maxInstallments && (!c.validThrough || c.validThrough >= c.validFrom), "Vigência/parcelas inválidas.");
export const feeRecognitionPolicySchema = z.object({ version: z.number().int().positive(), enabled: z.boolean(), variableAccountId: id, financialAccountId: id,
  closedThroughMonth: month.nullable(), closedPeriods: z.array(month).max(120), contracts: z.array(feeRateContractSchema).max(40),
}).strict().refine(p => new Set(p.contracts.map(c => `${c.id}:${c.version}`)).size === p.contracts.length, "Contrato/revisão duplicados.");
export type FeeRecognitionPolicy = z.infer<typeof feeRecognitionPolicySchema>;
export type FeeRateContract = z.infer<typeof feeRateContractSchema>;
export type FeeRecognitionComponent = { id: string; kind: FeeKind; transactionId: string; installment: number; soldOn: string; dueOn: string;
  grossDecimal: string; feeDecimal: string; expectedNetDecimal: string; measurement: "assessed" | "estimated"; basis: "provider_fee" | "capture_net" | "contract";
  sourceFileId: string; sourceHash: string; reviewId: string; reviewRevision: number; reviewFingerprint: string;
  contractId: string | null; contractVersion: number | null; settledOn: string | null; paidNetDecimal: string | null; anticipationDecimal: string | null };
export type FeeRecognitionBatch = { id: string; fingerprint: string; kind: FeeKind; soldOn: string; dueOn: string; amountCents: number; grossCents: number; expectedNetCents: number;
  measurement: "assessed" | "estimated"; members: FeeRecognitionComponent[] };
export type FeeRecognitionRecord = { schemaVersion: 2; id: string; workspaceId: string; unitId: string; stoneCode: string; referenceDate: string; source: "pix" | "cards";
  active: boolean; revision: number; batch: FeeRecognitionBatch; expenseId: string | null; accountPlanId: string; resultCenterId: string; resultCenterName: string;
  createdExpense?: boolean; previousFields?: Record<string, unknown>; previousMissing?: string[];
  policyVersion: number; state: "assessed" | "estimated" | "partially_received" | "received" | "cancelled"; receivedComponentIds: string[]; expenseGuard: string | null; updatedAt: string };
export type FeeRecognitionPreview = { request: z.infer<typeof feeRequestSchema>; batches: FeeRecognitionBatch[]; records: FeeRecognitionRecord[]; pending: string[];
  policy: FeeRecognitionPolicy | null; centers: Array<{ id: string; name: string }>; sourceStatus: string };
export const feeRecognitionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_sales"), request: feeRequestSchema }).strict(),
  z.object({ action: z.enum(["recognize_sale", "revise_sale", "link_sale"]), request: feeRequestSchema, batchId: hash, fingerprint: hash,
    resultCenterId: id, expenseId: id.optional(), expenseFingerprint: hash.optional(), expectedRevision: z.number().int().nonnegative(), confirmedNoManualExpense: z.literal(true), reason: z.string().trim().min(3).max(500).optional() }).strict(),
  z.object({ action: z.literal("candidates_sale"), request: feeRequestSchema, batchId: hash, fingerprint: hash, resultCenterId: id }).strict(),
  z.object({ action: z.literal("settle_sales"), request: feeRequestSchema, paymentDate: date, reason: z.string().trim().min(3).max(500).optional() }).strict(),
  z.object({ action: z.literal("reverse_sale"), request: feeRequestSchema, batchId: hash, expectedRevision: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict(),
]);
export type FeeRecognitionAction = z.infer<typeof feeRecognitionActionSchema>;
