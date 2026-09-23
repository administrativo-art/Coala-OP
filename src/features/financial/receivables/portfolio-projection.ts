import { AppError } from "@/lib/observability/app-error";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";

type File = ReturnType<typeof parseStoneAgendaXml>;
type Transaction = File["transactions"][number];
type Installment = Transaction["installments"][number];
type Event = { file: File; transaction: Transaction; installment: Installment };

const scale = BigInt(1_000_000_000_000);
const centScale = BigInt(10_000_000_000);
function decimalUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  return negative ? -units : units;
}
function decimal(value: bigint): string {
  const absolute = value < 0 ? -value : value;
  return `${value < 0 ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(12, "0")}`;
}
const keyOf = (transaction: Transaction, installment: Installment) => `${transaction.transactionId}:${installment.number}`;
const captureDate = (transaction: Transaction) => transaction.captureLocalDateTime
  ? `${transaction.captureLocalDateTime.slice(0, 4)}-${transaction.captureLocalDateTime.slice(4, 6)}-${transaction.captureLocalDateTime.slice(6, 8)}` : null;
const affected = (transaction: Transaction) =>
  ["Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"].some(name => transaction.events[name] > 0);
const cents = (value: string) => (decimalUnits(value) + centScale / BigInt(2)) / centScale;

export type StonePortfolioRow = {
  transactionId: string; installment: number; saleDate: string | null;
  dueDate: string | null; gross: string; net: string;
  status: "open" | "paid" | "review"; reason: string | null;
  paymentDate: string | null; sourceFileIds: string[];
};

/** Rebuild a merchant's sale installments from an uninterrupted run of daily
 * files. This is a Stone-acquirer projection, not bank cash or registradora data. */
export function projectStonePortfolio(input: {
  stoneCode: string; firstCaptureDate: string; asOf: string;
}, files: File[]) {
  const dates: string[] = [];
  for (let time = Date.parse(`${input.firstCaptureDate}T00:00:00Z`);
    time <= Date.parse(`${input.asOf}T00:00:00Z`); time += 86_400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  if (!dates.length || dates.length > 731 || dates[0] !== input.firstCaptureDate || dates.at(-1) !== input.asOf) {
    throw new AppError({ code: "STONE_PORTFOLIO_RANGE", kind: "VALIDATION" });
  }
  const byDate = new Map<string, File>();
  for (const file of files) {
    if (!file.referenceDate || !dates.includes(file.referenceDate) ||
      file.stoneCode.replace(/^0+(?=\d)/, "") !== input.stoneCode.replace(/^0+(?=\d)/, "")) {
      throw new AppError({ code: "STONE_PORTFOLIO_SCOPE", kind: "DATA_INTEGRITY" });
    }
    const previous = byDate.get(file.referenceDate);
    if (previous && JSON.stringify(previous) !== JSON.stringify(file)) {
      throw new AppError({ code: "STONE_PORTFOLIO_REVISION_CONFLICT", kind: "DATA_INTEGRITY" });
    }
    byDate.set(file.referenceDate, file);
  }
  const origins = new Map<string, Event[]>();
  const payments = new Map<string, Event[]>();
  const affectedTransactions = new Set<string>();
  const incompletePaymentTransactions = new Set<string>();
  const paymentSignals = new Set<string>();
  let unsupportedCaptureCount = 0;
  for (const date of dates) {
    const file = byDate.get(date);
    if (!file) continue;
    for (const transaction of file.transactions) {
      if (affected(transaction) || transaction.installments.some(row => row.suspendedByChargeback)) {
        affectedTransactions.add(transaction.transactionId);
      }
      if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0 && !transaction.installments.length) {
        unsupportedCaptureCount++;
      }
      if (transaction.events.Payments > 0 && !transaction.installments.length) {
        incompletePaymentTransactions.add(transaction.transactionId);
      }
      for (const installment of transaction.installments) {
        const key = keyOf(transaction, installment);
        const event = { file, transaction, installment };
        if (transaction.events.Payments > 0 || installment.paymentDate) paymentSignals.add(key);
        if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0) {
          origins.set(key, [...(origins.get(key) ?? []), event]);
        }
        if (transaction.sourceSection === "FinancialTransactionsAccounts" && transaction.events.Payments > 0) {
          payments.set(key, [...(payments.get(key) ?? []), event]);
        }
      }
    }
  }
  const rows: StonePortfolioRow[] = [];
  for (const [key, captures] of origins) {
    const origin = captures[0];
    const installment = origin.installment;
    const paymentEvents = payments.get(key) ?? [];
    const payment = paymentEvents.find(event => !!event.installment.paymentDate);
    let reason: string | null = null;
    if (captures.length !== 1 || origin.transaction.events.Captures !== 1) reason = "Captura duplicada ou múltipla.";
    else if (captureDate(origin.transaction) !== origin.file.referenceDate || !installment.expectedPaymentDate ||
      decimalUnits(installment.netAmount) < 0 || decimalUnits(installment.grossAmount) <= 0 ||
      decimalUnits(installment.netAmount) > decimalUnits(installment.grossAmount)) reason = "Origem ou valores incompletos.";
    else if (affectedTransactions.has(origin.transaction.transactionId)) reason = "Cancelamento, contestação ou suspensão requer conferência.";
    else if (incompletePaymentTransactions.has(origin.transaction.transactionId)) reason = "Pagamento sem detalhamento da parcela.";
    else if (paymentEvents.length && (paymentEvents.length !== 1 || !payment ||
      !payment.installment.paymentId || payment.installment.paymentDate !== payment.file.referenceDate ||
      cents(payment.installment.grossAmount) !== cents(installment.grossAmount)))
      reason = "Pagamento parcial, duplicado ou incompatível.";
    else if (!paymentEvents.length && paymentSignals.has(key)) reason = "Pagamento sinalizado sem liquidação detalhada.";
    const status = reason ? "review" : payment ? "paid" : "open";
    rows.push({ transactionId: origin.transaction.transactionId, installment: installment.number,
      saleDate: captureDate(origin.transaction), dueDate: installment.expectedPaymentDate,
      gross: installment.grossAmount, net: installment.netAmount, status, reason,
      paymentDate: payment?.installment.paymentDate ?? null,
      sourceFileIds: [...new Set([...captures, ...paymentEvents].map(event => event.file.fileId))] });
  }
  rows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.transactionId.localeCompare(b.transactionId) || a.installment - b.installment);
  const open = rows.filter(row => row.status === "open");
  const review = rows.filter(row => row.status === "review");
  const missingDates = dates.filter(date => !byDate.has(date));
  return { firstCaptureDate: input.firstCaptureDate, asOf: input.asOf, rows,
    summary: { openCount: open.length, openNet: missingDates.length || review.length || unsupportedCaptureCount
      ? null : decimal(open.reduce((sum, row) => sum + decimalUnits(row.net), BigInt(0))),
      paidCount: rows.filter(row => row.status === "paid").length,
      reviewCount: review.length, unsupportedCaptureCount,
      paymentsWithoutOriginCount: [...payments.keys()].filter(key => !origins.has(key)).length },
    missingDates, coverage: "merchant_capture_history_through_published_date" as const,
    bankReceiptConfirmed: false as const, registradoraConfirmed: false as const };
}
