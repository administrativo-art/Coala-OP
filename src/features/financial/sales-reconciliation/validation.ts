import { z } from "zod";
import { closureDateFromIso, shiftClosureDate } from "../cash-closures/date";
import { AppError } from "../../../lib/observability/app-error";

export const MAX_SALES_REVIEW_FACTS = 500;
// Two bounded sources can be added/subtracted without losing integer precision.
export const MAX_SALE_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / (MAX_SALES_REVIEW_FACTS * 2));
export const reviewId = z.string().trim().min(1).max(180);
export const reviewDate = z.string().refine(value => {
  try { return shiftClosureDate(value, 0) === value; } catch { return false; }
});
export const reviewTimestamp = z.string().max(50).refine(value => {
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/);
  return !!parts && reviewDate.safeParse(parts[1]).success && Number.isFinite(new Date(parts[3] ? value.replace(" ", "T") : `${value.replace(" ", "T")}-03:00`).getTime());
});
const optionalId = reviewId.nullable().optional();
const factSchema = z.object({
  id: reviewId, source: z.enum(["pdv", "stone"]), workspaceId: reviewId,
  kioskId: reviewId.nullable(), businessDate: reviewDate, soldAt: reviewTimestamp,
  channel: z.enum(["pix", "credit_card", "debit_card"]),
  grossAmountCents: z.number().int().min(1).max(MAX_SALE_CENTS),
  status: z.enum(["approved", "pending", "cancelled", "refunded", "chargeback"]),
  couponId: optionalId,
  identifiers: z.object({ providerTransactionId: optionalId, nsu: optionalId,
    authorizationCode: optionalId, terminalId: optionalId, merchantOrderId: optionalId }).strict(),
}).strict().refine(fact => {
  try { return closureDateFromIso(fact.soldAt) === fact.businessDate; } catch { return false; }
});
const facts = z.array(factSchema).max(MAX_SALES_REVIEW_FACTS)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
const inputSchema = z.object({
  pdvFacts: facts.refine(rows => rows.every(row => row.source === "pdv")),
  stoneSales: facts.refine(rows => rows.every(row => row.source === "stone")),
  timeWindowMs: z.number().int().min(0).max(300_000).optional(),
}).strict();

export function invalidSalesReview(): never {
  throw new AppError({ code: "SALES_REVIEW_INVALID_SOURCE", kind: "DATA_INTEGRITY",
    safeMessage: "Os dados não permitem uma comparação segura das vendas." });
}

export function validateMatchInput(input: unknown) {
  if (!inputSchema.safeParse(input).success) invalidSalesReview();
}

/** No rounding: sub-cent values require review, not a fabricated equality. */
export function exactSalesCents(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim();
  const parts = value.match(/^(\d{1,15})(?:\.(\d{1,12}))?$/);
  if (!parts || /[1-9]/.test((parts[2] ?? "").slice(2))) return null;
  const cents = BigInt(parts[1]) * BigInt(100) + BigInt((parts[2] ?? "").padEnd(2, "0").slice(0, 2));
  return cents <= BigInt(MAX_SALE_CENTS) ? Number(cents) : null;
}
