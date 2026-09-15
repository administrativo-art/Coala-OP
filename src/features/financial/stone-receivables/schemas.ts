import { z } from "zod";

const identifier = z.string().trim().min(1).max(180).refine((value) => !value.includes("/"));
const civilDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/);
const money = z.number().int().nonnegative().max(100_000_000_000);
const signedMoney = z.number().int().min(-100_000_000_000).max(100_000_000_000);
const sourceHash = z.string().regex(/^[a-f0-9]{64}$/);

export const stoneReceivableImportSchema = z.object({
  receivableKey: identifier,
  externalSaleId: identifier.optional().nullable(),
  installmentNumber: z.number().int().min(1).max(99),
  installmentCount: z.number().int().min(1).max(99),
  stoneCode: identifier,
  kioskId: identifier.optional().nullable(),
  kioskName: z.string().trim().min(1).max(180).optional().nullable(),
  accountId: identifier,
  grossAmountCents: money,
  mdrAmountCents: money,
  anticipationFeeAmountCents: money.default(0),
  adjustmentAmountCents: signedMoney.default(0),
  netAmountCents: money,
  settledAmountCents: money.default(0),
  originalExpectedDate: civilDate,
  currentExpectedDate: civilDate,
  settledAt: z.string().datetime({ offset: true }).optional().nullable(),
  status: z.enum(["scheduled", "partially_settled", "settled", "overdue", "cancelled", "chargeback"]),
  sourceRevision: z.string().trim().min(1).max(120),
  sourceHash,
}).superRefine((value, context) => {
  const computedNet = value.grossAmountCents
    - value.mdrAmountCents
    - value.anticipationFeeAmountCents
    + value.adjustmentAmountCents;
  if (computedNet !== value.netAmountCents) {
    context.addIssue({ code: "custom", path: ["netAmountCents"], message: "O líquido não fecha com bruto, taxas e ajustes." });
  }
  if (value.settledAmountCents > value.netAmountCents) {
    context.addIssue({ code: "custom", path: ["settledAmountCents"], message: "A liquidação excede o valor líquido." });
  }
  if (value.installmentNumber > value.installmentCount) {
    context.addIssue({ code: "custom", path: ["installmentNumber"], message: "A parcela excede a quantidade total." });
  }
});

export const stoneSettlementImportSchema = z.object({
  externalSettlementId: identifier,
  stoneCode: identifier,
  accountId: identifier,
  settledAt: z.string().datetime({ offset: true }),
  grossAmountCents: money,
  feeAmountCents: money.default(0),
  adjustmentAmountCents: signedMoney.default(0),
  netAmountCents: money,
  receivableKeys: z.array(identifier).max(500).default([]),
  providerBankReference: z.string().trim().max(180).optional().nullable(),
  sourceRevision: z.string().trim().min(1).max(120),
  sourceHash,
}).superRefine((value, context) => {
  if (value.grossAmountCents - value.feeAmountCents + value.adjustmentAmountCents !== value.netAmountCents) {
    context.addIssue({ code: "custom", path: ["netAmountCents"], message: "O líquido da liquidação não fecha." });
  }
});

export const stoneFinancialImportBatchSchema = z.object({
  workspaceId: identifier,
  source: z.enum(["stone_receivables", "stone_settlements"]),
  idempotencyKey: z.string().trim().min(12).max(180),
  rows: z.array(z.unknown()).min(1).max(200),
});

export const stoneReceivablesListQuerySchema = z.object({
  from: civilDate,
  to: civilDate,
  kioskId: identifier.optional(),
  status: z.enum(["scheduled", "partially_settled", "settled", "overdue", "cancelled", "chargeback"]).optional(),
  cursor: z.string().trim().min(3).max(260).regex(/^[A-Za-z0-9._:|-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine((value) => value.to >= value.from, { path: ["to"], message: "O fim deve ser posterior ao início." });

export type StoneFinancialImportBatchInput = z.infer<typeof stoneFinancialImportBatchSchema>;
