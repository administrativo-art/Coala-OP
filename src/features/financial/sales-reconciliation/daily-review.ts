import { z } from "zod";
import { parseStoneAgendaXml } from "../../../lib/integrations/stone/agenda-parser";
import { isPdvItemCancelled, pdvCouponItems } from "../../../lib/integrations/pdv-coupon-ingestion";
import { parsePdvCoupons } from "../cash-closures/pdv-coupon-parser";
import { normalizeChannel } from "../cash-closures/channel-normalization";
import { closureDateFromIso } from "../cash-closures/date";
import { suggestSalesReconciliationCases } from "./matching";
import { exactSalesCents, invalidSalesReview, MAX_SALE_CENTS, MAX_SALES_REVIEW_FACTS, reviewDate, reviewId, reviewTimestamp } from "./validation";
import type { ReconciliationSalesChannel, SalesMatchFact, SalesSourceIdentifiers } from "./types";

const scopeSchema = z.object({ workspaceId: reviewId, kioskId: reviewId,
  stoneCode: z.string().regex(/^\d{1,20}$/), referenceDate: reviewDate }).strict();
export type DailySalesScope = z.infer<typeof scopeSchema>;
export type SalesSourceIssue = {
  source: "pdv" | "stone"; reference: string;
  reason: "invalid_coupon" | "duplicate_coupon" | "invalid_payments" | "invalid_date" |
    "outside_day" | "unsupported_channel" | "invalid_amount" | "non_capture_event" |
    "cancellation_event" | "cancellation_charge_event" | "chargeback_event" |
    "chargeback_refund_event" | "unsupported_capture";
};
type StoneAdverseIssueReason = Extract<SalesSourceIssue["reason"],
  "cancellation_event" | "cancellation_charge_event" | "chargeback_event" | "chargeback_refund_event">;
const record = z.record(z.unknown());
const couponsSchema = z.array(record).max(MAX_SALES_REVIEW_FACTS);

function field(row: Record<string, unknown>, keys: string[]) {
  const values = keys.map(key => row[key]).filter(value => value !== undefined && value !== null);
  // Conflicting aliases must not be resolved by arbitrary precedence.
  if (values.length > 1 && values.some(value => JSON.stringify(value) !== JSON.stringify(values[0]))) return undefined;
  return values[0];
}
function couponId(row: Record<string, unknown>) {
  const raw = field(row, ["codcupom", "CodCupom", "codCupom"]);
  const value = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
  const parsed = reviewId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function detailIdentifier(row: Record<string, unknown>, keys: string[]) {
  const raw = field(row, keys);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || /^(?:null|undefined)$/i.test(value)) return null;
  const parsed = reviewId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function providerName(row: Record<string, unknown>, keys: string[]) {
  const raw = field(row, keys);
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

function stoneAdverseIssueReasons(row: { events: Record<string, number>; canceledAmount: string | null }) {
  const reasons: StoneAdverseIssueReason[] = [];
  if (row.events.Cancellations > 0
    || (row.canceledAmount !== null && exactSalesCents(row.canceledAmount) !== 0)) reasons.push("cancellation_event");
  if (row.events.CancellationCharges > 0) reasons.push("cancellation_charge_event");
  if (row.events.Chargebacks > 0) reasons.push("chargeback_event");
  if (row.events.ChargebackRefunds > 0) reasons.push("chargeback_refund_event");
  return reasons;
}

function pdvPaymentIdentifiers(payment: Record<string, unknown>, channel: ReconciliationSalesChannel): SalesSourceIdentifiers {
  const rawDetails = field(payment, ["detalhes", "Detalhes"]);
  // A payment row can aggregate more than one operation. Without exactly one
  // detail, no individual identifier can safely be attached to the fact.
  if (!Array.isArray(rawDetails) || rawDetails.length !== 1) return {};
  const parsed = record.safeParse(rawDetails[0]);
  if (!parsed.success) return {};
  const detail = parsed.data;
  const nsu = detailIdentifier(detail, ["nsu", "Nsu", "NSU"]);
  const authorizationCode = detailIdentifier(detail,
    ["codigoautorizacao", "codigoAutorizacao", "CodigoAutorizacao"]);
  const explicitlyStone = [
    providerName(detail, ["subadquirente", "SubAdquirente"]),
    providerName(detail, ["adquirente", "Adquirente"]),
    providerName(detail, ["gateway", "Gateway"]),
  ].includes("STONE");
  const card = channel === "credit_card" || channel === "debit_card";

  return {
    ...(nsu && card && explicitlyStone ? { providerTransactionId: nsu } : {}),
    ...(nsu ? { nsu } : {}),
    ...(authorizationCode ? { authorizationCode } : {}),
  };
}

function pdvTimestampMillis(value: string) {
  return new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value)
    ? value.replace(" ", "T") : `${value.replace(" ", "T")}-03:00`).getTime();
}

function itemCancellationAdjustment(row: Record<string, unknown>, finalAmountCents: number, finalizedAt: string) {
  const items = pdvCouponItems(row);
  if (!items.length) return undefined;
  let originalAmountCents = 0;
  let cancelledAmountCents = 0;
  const cancellationTimes: string[] = [];
  let cancelledItems = 0;
  for (const item of items) {
    const amount = exactSalesCents(field(item, ["valortotal", "ValorTotal"]));
    if (amount === null) return undefined;
    originalAmountCents += amount;
    if (!Number.isSafeInteger(originalAmountCents) || originalAmountCents > MAX_SALE_CENTS) return undefined;
    if (isPdvItemCancelled(item)) {
      cancelledItems++;
      cancelledAmountCents += amount;
      if (!Number.isSafeInteger(cancelledAmountCents) || cancelledAmountCents > MAX_SALE_CENTS) return undefined;
      const rawTimestamp = field(item, ["dtcancelamento", "DtCancelamento"]);
      if (typeof rawTimestamp === "string" && reviewTimestamp.safeParse(rawTimestamp).success) {
        cancellationTimes.push(rawTimestamp);
      }
    }
  }
  if (!cancelledItems || cancelledAmountCents <= 0
    || originalAmountCents - cancelledAmountCents !== finalAmountCents) return undefined;
  const allCancellationTimesKnown = cancellationTimes.length === cancelledItems;
  const lastCancellationAt = allCancellationTimesKnown
    ? [...cancellationTimes].sort((left, right) => pdvTimestampMillis(left) - pdvTimestampMillis(right)).at(-1) ?? null
    : null;
  return {
    type: "item_cancellation" as const,
    originalAmountCents,
    cancelledAmountCents,
    finalAmountCents,
    lastCancellationAt,
    finalizedAt,
    finalizedAfterCancellation: lastCancellationAt !== null
      && pdvTimestampMillis(finalizedAt) >= pdvTimestampMillis(lastCancellationAt),
  };
}

/** Reuses cash-closure parsing only after rejecting its tolerant zero/ID fallbacks. */
function pdvFacts(raw: unknown, scope: DailySalesScope, issues: SalesSourceIssue[]) {
  const validated = couponsSchema.safeParse(raw);
  if (!validated.success) invalidSalesReview();
  const rows = validated.data;
  const ids = rows.map(couponId);
  const facts: SalesMatchFact[] = [];
  rows.forEach((row, index) => {
    const id = ids[index];
    const reference = id ?? `row:${index}`;
    const issue = (reason: SalesSourceIssue["reason"]) => issues.push({ source: "pdv", reference, reason });
    if (!id) { issue("invalid_coupon"); return; }
    if (ids.filter(value => value === id).length !== 1) { issue("duplicate_coupon"); return; }
    const total = exactSalesCents(field(row, ["valortotal", "ValorTotal"]));
    const payments = field(row, ["formaPgtos", "FormaPgtos", "formapgtos"]);
    if (total === null || !Array.isArray(payments) || !payments.length || payments.length > 100) {
      issue("invalid_payments"); return;
    }
    let paymentTotal = BigInt(0);
    for (const payment of payments) {
      if (!record.safeParse(payment).success) { issue("invalid_payments"); return; }
      const name = field(payment, ["nome", "Nome"]);
      const amount = exactSalesCents(field(payment, ["valortotal", "ValorTotal"]));
      if (typeof name !== "string" || !name.trim() || name.length > 180 || amount === null || amount <= 0) {
        issue("invalid_payments"); return;
      }
      paymentTotal += BigInt(amount) * BigInt(normalizeChannel(name).sign);
    }
    if (paymentTotal !== BigInt(total)) { issue("invalid_payments"); return; }
    const parsed = parsePdvCoupons([row]);
    const coupon = parsed.coupons[0];
    if (!coupon || parsed.parseWarnings.length || !reviewTimestamp.safeParse(coupon.timestamp).success) {
      issue("invalid_date"); return;
    }
    if (closureDateFromIso(coupon.timestamp) !== scope.referenceDate) { issue("outside_day"); return; }
    // Missing/unknown PDV status is not evidence of provider approval.
    const rawStorno = field(row, ["isestornado", "IsEstornado"]);
    const storned = coupon.isStorned || rawStorno === 1;
    const adjustment = coupon.hasExplicitItemCancellation
      ? itemCancellationAdjustment(row, total, coupon.timestamp)
      : undefined;
    const status = storned ? "refunded"
      : coupon.isCancelled && coupon.hasExplicitItemCancellation
        ? adjustment?.finalizedAfterCancellation ? "pending" : "partial_cancellation"
        : coupon.isCancelled ? "cancelled" : "pending";
    coupon.paymentRows.forEach((payment, paymentIndex) => {
      const { channel } = normalizeChannel(payment.rawName);
      if (channel === "cash") return;
      if (channel !== "pix" && channel !== "credit_card" && channel !== "debit_card") { issue("unsupported_channel"); return; }
      facts.push({ id: JSON.stringify([id, paymentIndex]), source: "pdv", workspaceId: scope.workspaceId,
        kioskId: scope.kioskId, businessDate: scope.referenceDate, soldAt: coupon.timestamp, channel,
        // Take the validated raw decimal, not the legacy parser's float conversion.
        grossAmountCents: exactSalesCents(field(payments[paymentIndex], ["valortotal", "ValorTotal"]))!,
        status, couponId: id, identifiers: pdvPaymentIdentifiers(payments[paymentIndex], channel),
        ...(adjustment ? { adjustment } : {}) });
    });
  });
  if (facts.length > MAX_SALES_REVIEW_FACTS) invalidSalesReview();
  return facts;
}

/** Pure, read-only adapter. The caller must authenticate and resolve both unit mappings
 * before supplying these source payloads. This is not an authorization boundary. */
export function reviewDailySales(input: { scope: DailySalesScope; pdvCoupons: unknown; stoneXml: string }) {
  const parsed = scopeSchema.safeParse(input.scope);
  if (!parsed.success) invalidSalesReview();
  const scope = parsed.data;
  const file = parseStoneAgendaXml(input.stoneXml, scope);
  if (file.transactions.length > MAX_SALES_REVIEW_FACTS) invalidSalesReview();
  const issues: SalesSourceIssue[] = [];
  const pdv = pdvFacts(input.pdvCoupons, scope, issues);
  const stone: SalesMatchFact[] = [];
  const adverseReasonsById = new Map<string, Set<StoneAdverseIssueReason>>();
  for (const row of file.transactions) {
    const reasons = stoneAdverseIssueReasons(row);
    if (!reasons.length) continue;
    const current = adverseReasonsById.get(row.transactionId) ?? new Set<StoneAdverseIssueReason>();
    reasons.forEach(reason => current.add(reason));
    adverseReasonsById.set(row.transactionId, current);
  }
  for (const [transactionId, reasons] of adverseReasonsById) {
    reasons.forEach(reason => issues.push({ source: "stone",
      reference: JSON.stringify([file.fileId, transactionId]), reason }));
  }
  for (const row of file.transactions) {
    const issue = (reason: SalesSourceIssue["reason"]) => issues.push({ source: "stone",
      reference: JSON.stringify([file.fileId, row.sourceSection, row.transactionId]), reason });
    const adverseReasons = adverseReasonsById.get(row.transactionId);
    if (adverseReasons) continue;
    // Account movements/payment events must never be imported as new sales.
    if (row.sourceSection !== "FinancialTransactions" || row.events.Captures === 0) { issue("non_capture_event"); continue; }
    const channel = row.accountTypeCode === "1" || row.accountTypeCode === "3" ? "debit_card"
      : row.accountTypeCode === "2" || row.accountTypeCode === "4" ? "credit_card" : null;
    if (!channel || row.currencyCode !== "986" || row.events.Captures !== 1 || !row.captureLocalDateTime) {
      issue("unsupported_capture"); continue;
    }
    const value = row.captureLocalDateTime;
    const soldAt = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}-03:00`;
    if (closureDateFromIso(soldAt) !== scope.referenceDate) { issue("outside_day"); continue; }
    const cents = exactSalesCents(row.capturedAmount);
    if (cents === null || cents <= 0) { issue("invalid_amount"); continue; }
    stone.push({ id: row.transactionId, source: "stone", workspaceId: scope.workspaceId,
      kioskId: scope.kioskId, businessDate: scope.referenceDate, soldAt, channel,
      grossAmountCents: cents, status: "approved", identifiers: { providerTransactionId: row.transactionId } });
  }
  const uncomparedPdvFacts = pdv.filter(fact => fact.channel === "pix");
  return {
    scope, stoneFileId: file.fileId, coverage: "partial" as const, bankReceiptConfirmed: false as const,
    pdvFacts: pdv, stoneSales: stone, uncomparedPdvFacts, issues,
    stoneEvents: file.transactions.map(row => ({ sourceSection: row.sourceSection, transactionId: row.transactionId,
      captureLocalDateTime: row.captureLocalDateTime, capturedAmount: row.capturedAmount,
      canceledAmount: row.canceledAmount, events: row.events })),
    cases: suggestSalesReconciliationCases({ pdvFacts: pdv.filter(fact => fact.channel !== "pix"), stoneSales: stone }),
    limitations: [
      "Comparação de um dia e um StoneCode, não da carteira ou de todos os adquirentes da unidade.",
      "Ausência de par no recorte não comprova venda ausente; o PDV pode incluir outros adquirentes.",
      "O PDV consultado não fornece aprovação da adquirente. Pares individuais únicos por valor e janela de cinco minutos são conferidos automaticamente dentro deste recorte; agrupamentos continuam pendentes.",
      "Pix não foi comparado: exige arquivo próprio e vínculo comprovado do terminal à unidade.",
      "Cancelamentos, estornos e chargebacks Stone exigem o histórico da venda; ficam como evidências pendentes, sem compensar totais.",
      "A conferência automática valida somente a compatibilidade PDV × Stone do recorte; não lança receita/despesa nem confirma recebimento bancário.",
    ],
  };
}
