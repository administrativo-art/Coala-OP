import { AppError } from "../../observability/app-error";
import { parseStoneAgendaXml } from "./agenda-parser";
import { stoneAgendaQuerySchema } from "./agenda-query";

type File = ReturnType<typeof parseStoneAgendaXml>;
type Transaction = File["transactions"][number];
type Installment = Transaction["installments"][number];
const scale = BigInt("1000000000000");
// XML allows twelve decimal places. Never round each installment to cents.
function units(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  return negative ? -result : result;
}
function decimal(value: bigint): string {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(12, "0")}`;
}
const civil = (value: string | null) => value
  ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
const affected = (t: Transaction, i: Installment) => i.suspendedByChargeback ||
  ["Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"].some(k => t.events[k] > 0);

export type AnticipationReviewRow = {
  transactionId: string; installment: number; saleDate: string | null;
  originalDueDate: string | null; paymentDate: string | null; paymentId: string | null;
  gross: string; originalNet: string | null; paidNet: string; mdr: string | null;
  additionalDiscount: string | null;
  anticipationFee: string | null; providerOriginalDueDate: string | null;
  providerAnticipationConfirmed: boolean; unexplainedDifference: string | null;
  status: "paid_early" | "regular_payment" | "needs_review";
  reason: string | null; originalFileId: string | null;
};

/** Evidence comparison, NOT a portfolio balance, accounting entry or RAV classification. */
export function compareStonePayments(paymentFile: File, originals: File[]) {
  if (originals.some(f => f.stoneCode.replace(/^0+/, "") !== paymentFile.stoneCode.replace(/^0+/, ""))) {
    throw new AppError({ code: "STONE_REVIEW_SCOPE_MISMATCH", kind: "DATA_INTEGRITY" });
  }
  const index = new Map<string, { transaction: Transaction; installment: Installment; file: File }>();
  const duplicate = new Set<string>();
  for (const file of originals) for (const transaction of file.transactions) {
    if (transaction.sourceSection !== "FinancialTransactions" || !transaction.events.Captures) continue;
    for (const installment of transaction.installments) {
      const key = `${transaction.transactionId}:${installment.number}`;
      if (index.has(key)) duplicate.add(key);
      index.set(key, { transaction, installment, file });
    }
  }
  const seen = new Set<string>();
  const rows: AnticipationReviewRow[] = [];
  for (const transaction of paymentFile.transactions) {
    if (transaction.sourceSection !== "FinancialTransactionsAccounts" || !transaction.events.Payments) continue;
    for (const item of transaction.installments) {
      const key = `${transaction.transactionId}:${item.number}`;
      if (seen.has(key)) throw new AppError({ code: "STONE_REVIEW_DUPLICATE_PAYMENT", kind: "DATA_INTEGRITY" });
      seen.add(key);
      const original = index.get(key);
      let reason: string | null = null;
      if (!original) reason = "Arquivo original indisponível ou parcela não localizada.";
      else if (duplicate.has(key)) reason = "Mais de uma origem para a mesma parcela.";
      else if (affected(transaction, item) || affected(original.transaction, original.installment)) reason = "Parcela com estorno, cancelamento ou contestação.";
      else if (!item.paymentDate || !item.paymentId || item.paymentDate !== paymentFile.referenceDate || !original.installment.expectedPaymentDate) reason = "Datas ou identificação do pagamento incompletas/incompatíveis.";
      else if (civil(transaction.captureLocalDateTime) !== original.file.referenceDate || civil(original.transaction.captureLocalDateTime) !== original.file.referenceDate) reason = "Data da venda incompatível com a origem.";
      else if (units(item.grossAmount) !== units(original.installment.grossAmount) || units(item.grossAmount) <= BigInt(0)) reason = "Pagamento parcial ou valor bruto incompatível; revisar vínculo.";
      else if (item.advancedReceivableOriginalPaymentDate && item.advancedReceivableOriginalPaymentDate !== original.installment.expectedPaymentDate) reason = "Vencimento da antecipação diverge do arquivo original.";
      else if (item.advanceRateAmount !== null && units(item.advanceRateAmount) < BigInt(0)) reason = "Custo de antecipação negativo; revisar ajuste ou reversão.";
      const originalNet = original?.installment.netAmount ?? null;
      rows.push({ transactionId: transaction.transactionId, installment: item.number,
        saleDate: civil(transaction.captureLocalDateTime), originalDueDate: original?.installment.expectedPaymentDate ?? null,
        paymentDate: item.paymentDate, paymentId: item.paymentId, gross: item.grossAmount,
        originalNet, paidNet: item.netAmount, mdr: item.mdrAmount,
        additionalDiscount: reason || originalNet === null ? null : decimal(units(originalNet) - units(item.netAmount)),
        anticipationFee: item.advanceRateAmount,
        providerOriginalDueDate: item.advancedReceivableOriginalPaymentDate,
        providerAnticipationConfirmed: !reason && item.advanceRateAmount !== null &&
          !!item.advancedReceivableOriginalPaymentDate && !!item.paymentDate && item.paymentDate < item.advancedReceivableOriginalPaymentDate,
        unexplainedDifference: reason || item.advanceRateAmount === null || item.mdrAmount === null ? null :
          decimal(units(item.grossAmount) - units(item.netAmount) - units(item.mdrAmount) - units(item.advanceRateAmount)),
        status: reason ? "needs_review" : item.paymentDate! < original!.installment.expectedPaymentDate! ? "paid_early" : "regular_payment",
        reason, originalFileId: original?.file.fileId ?? null,
      });
    }
  }
  const early = rows.filter(r => r.status === "paid_early");
  const sum = (field: "gross" | "paidNet" | "originalNet" | "mdr" | "additionalDiscount" | "anticipationFee" | "unexplainedDifference") =>
    early.some(r => r[field] === null) ? null : decimal(early.reduce((acc, r) => acc + units(r[field]!), BigInt(0)));
  return { rows, summary: { earlyCount: early.length, pendingCount: rows.filter(r => r.status === "needs_review").length,
    regularCount: rows.filter(r => r.status === "regular_payment").length,
    gross: sum("gross"), paidNet: sum("paidNet"), originalNet: sum("originalNet"), mdr: sum("mdr"), additionalDiscount: sum("additionalDiscount"),
    anticipationFee: sum("anticipationFee"), unexplainedDifference: sum("unexplainedDifference"),
    providerConfirmedCount: early.filter(r => r.providerAnticipationConfirmed).length } };
}

/** Bounded manual query: one payment file + at most 31 original dates, two concurrent reads. */
export async function queryStoneAnticipationReview(input: unknown, context: { isDefaultAdmin: boolean },
  read: (query: { stoneCode: string; referenceDate: string }) => Promise<string>) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_REVIEW_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = stoneAgendaQuerySchema.pick({ stoneCode: true, referenceDate: true }).strict().safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_REVIEW_INVALID_QUERY", kind: "VALIDATION" });
  const query = parsed.data;
  const paymentFile = parseStoneAgendaXml(await read(query), query);
  const payments = paymentFile.transactions.filter(t => t.sourceSection === "FinancialTransactionsAccounts" && t.events.Payments);
  const paymentIds = new Set(payments.map(t => t.transactionId));
  const dates = [...new Set(payments.map(t => civil(t.captureLocalDateTime)).filter((d): d is string => !!d && d <= query.referenceDate))].sort();
  const originalFiles: File[] = [];
  const unavailableDates: string[] = [];
  const selected = dates.slice(0, 31);
  for (let start = 0; start < selected.length; start += 2) {
    await Promise.all(selected.slice(start, start + 2).map(async referenceDate => {
      try {
        const scope = { stoneCode: query.stoneCode, referenceDate };
        const file = referenceDate === query.referenceDate ? paymentFile : parseStoneAgendaXml(await read(scope), scope);
        // Retain only payment-day origins, not 31 entire merchant histories.
        originalFiles.push({ ...file, transactions: file.transactions.filter(t => paymentIds.has(t.transactionId)) });
      } catch { unavailableDates.push(referenceDate); }
    }));
  }
  return { ...compareStonePayments(paymentFile, originalFiles), stoneCode: query.stoneCode,
    referenceDate: query.referenceDate, collectedAt: new Date().toISOString(), paymentFileId: paymentFile.fileId,
    coverage: "payment_day_comparison_not_full_portfolio" as const,
    ravConfirmed: false as const, bankReceiptConfirmed: false as const, writesPerformed: false as const,
    unavailableDates: unavailableDates.sort(), skippedDates: dates.slice(31),
  };
}
export type StoneAnticipationReview = Awaited<ReturnType<typeof queryStoneAnticipationReview>>;
