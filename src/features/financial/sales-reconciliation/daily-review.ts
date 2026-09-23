import { z } from "zod";
import { parseStoneAgendaXml } from "../../../lib/integrations/stone/agenda-parser";
import { parsePdvCoupons } from "../cash-closures/pdv-coupon-parser";
import { normalizeChannel } from "../cash-closures/channel-normalization";
import { closureDateFromIso } from "../cash-closures/date";
import { suggestSalesReconciliationCases } from "./matching";
import { exactSalesCents, invalidSalesReview, MAX_SALES_REVIEW_FACTS, reviewDate, reviewId, reviewTimestamp } from "./validation";
import type { SalesMatchFact } from "./types";

const scopeSchema = z.object({ workspaceId: reviewId, kioskId: reviewId,
  stoneCode: z.string().regex(/^\d{1,20}$/), referenceDate: reviewDate }).strict();
export type DailySalesScope = z.infer<typeof scopeSchema>;
export type SalesSourceIssue = {
  source: "pdv" | "stone"; reference: string;
  reason: "invalid_coupon" | "duplicate_coupon" | "invalid_payments" | "invalid_date" |
    "outside_day" | "unsupported_channel" | "invalid_amount" | "non_capture_event" |
    "cancellation_event" | "unsupported_capture";
};
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
    const status = storned ? "refunded" : coupon.isCancelled && !coupon.hasExplicitItemCancellation ? "cancelled" : "pending";
    coupon.paymentRows.forEach((payment, paymentIndex) => {
      const { channel } = normalizeChannel(payment.rawName);
      if (channel === "cash") return;
      if (channel !== "pix" && channel !== "credit_card" && channel !== "debit_card") { issue("unsupported_channel"); return; }
      facts.push({ id: JSON.stringify([id, paymentIndex]), source: "pdv", workspaceId: scope.workspaceId,
        kioskId: scope.kioskId, businessDate: scope.referenceDate, soldAt: coupon.timestamp, channel,
        // Take the validated raw decimal, not the legacy parser's float conversion.
        grossAmountCents: exactSalesCents(field(payments[paymentIndex], ["valortotal", "ValorTotal"]))!,
        status, couponId: id, identifiers: {} });
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
  const affectedIds = new Set(file.transactions.filter(row =>
    ["Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"].some(key => row.events[key] > 0)
    || (row.canceledAmount !== null && exactSalesCents(row.canceledAmount) !== 0)).map(row => row.transactionId));
  for (const row of file.transactions) {
    const issue = (reason: SalesSourceIssue["reason"]) => issues.push({ source: "stone",
      reference: JSON.stringify([file.fileId, row.sourceSection, row.transactionId]), reason });
    if (affectedIds.has(row.transactionId)) { issue("cancellation_event"); continue; }
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
      "O PDV consultado não fornece vínculo transacional comprovado nem aprovação Stone; valor e horário geram apenas sugestões.",
      "Pix não foi comparado: exige arquivo próprio e vínculo comprovado do terminal à unidade.",
      "Cancelamentos, estornos e chargebacks Stone exigem o histórico da venda; ficam como evidências pendentes, sem compensar totais.",
      "Nenhuma sugestão aprova conciliação, lança receita/despesa ou confirma recebimento bancário.",
    ],
  };
}
