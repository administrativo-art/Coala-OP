import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { stoneAgendaQuerySchema } from "@/lib/integrations/stone/agenda-query";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { financialAgentIdentifier, type FinancialAgentMapping, type FinancialAgentRequest } from "../agent/contracts";
import { resolveFinancialAgentMapping } from "../agent/mapping";

const day = 86_400_000;
export const MAX_PERIOD_DAYS = 31;
export const MAX_PERIOD_ROWS = 5_000;
const civilDate = stoneAgendaQuerySchema.shape.referenceDate;
export const receivablePeriodSchema = z.object({
  kioskId: financialAgentIdentifier,
  stoneCode: stoneAgendaQuerySchema.shape.stoneCode,
  from: civilDate,
  through: civilDate,
}).strict().refine(v => v.from <= v.through && (Date.parse(v.through) - Date.parse(v.from)) / day < MAX_PERIOD_DAYS);
export type ReceivablePeriod = z.infer<typeof receivablePeriodSchema>;
type File = ReturnType<typeof parseStoneAgendaXml>;
type Transaction = File["transactions"][number];
type Installment = Transaction["installments"][number];
type Event = { file: File; transaction: Transaction; installment: Installment };
export type PeriodRow = {
  transactionId: string; installment: number; saleDate: string | null; dueDate: string | null;
  gross: string; originalNet: string; mdr: string | null; paidNet: string | null;
  paymentDate: string | null; paymentId: string | null;
  status: "projected" | "paid_early" | "paid" | "overdue_unconfirmed" | "needs_review";
  reason: string | null; sourceFileIds: string[];
};
const scale = BigInt("1000000000000");
function units(value: string) {
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (value.startsWith("-") ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0")));
}
function decimal(value: bigint) {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(12, "0")}`;
}
function failure(code: string, message: string, kind: "VALIDATION" | "DATA_INTEGRITY" | "EXPECTED_BUSINESS" = "DATA_INTEGRITY"): never {
  throw new AppError({ code, kind, safeMessage: message });
}
export function periodDates(period: ReceivablePeriod): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(period.from); time <= Date.parse(period.through); time += day) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}
/** Stone publishes a civil day only after 05:00 on the following day (Brazil UTC-3). */
export function latestPublishedDate(now: Date) {
  return new Date(now.getTime() - 8 * 3_600_000 - day).toISOString().slice(0, 10);
}
const saleDate = (t: Transaction) => t.captureLocalDateTime
  ? `${t.captureLocalDateTime.slice(0, 4)}-${t.captureLocalDateTime.slice(4, 6)}-${t.captureLocalDateTime.slice(6, 8)}` : null;
const affected = (t: Transaction) => ["Cancellations", "CancellationCharges", "Chargebacks", "ChargebackRefunds"].some(k => t.events[k] > 0);
const keyOf = (t: Transaction, i: Installment) => `${t.transactionId}:${i.number}`;

/** Projection of a bounded capture cohort, NEVER a complete or available portfolio balance. */
export function reviewReceivablePeriod(input: ReceivablePeriod, files: File[]) {
  const period = receivablePeriodSchema.parse(input);
  const expectedDates = periodDates(period);
  const observedDates = new Set<string>();
  const origins = new Map<string, Event[]>();
  const payments = new Map<string, Event[]>();
  const affectedTransactions = new Set<string>();
  const incompletePaymentTransactions = new Set<string>();
  const paymentSignals = new Set<string>();
  const seenFiles = new Map<string, string>();
  let unsupportedCaptureCount = 0;
  for (const file of files) {
    if (file.stoneCode.replace(/^0+/, "") !== period.stoneCode.replace(/^0+/, "") || !file.referenceDate || !expectedDates.includes(file.referenceDate)) {
      failure("STONE_PERIOD_SCOPE", "Um arquivo não corresponde ao código ou período solicitado.");
    }
    const fingerprint = JSON.stringify(file);
    if (seenFiles.has(file.referenceDate)) {
      if (seenFiles.get(file.referenceDate) !== fingerprint) failure("STONE_PERIOD_REVISION_CONFLICT", "Há revisões conflitantes para a mesma data.");
      continue;
    }
    seenFiles.set(file.referenceDate, fingerprint);
    observedDates.add(file.referenceDate);
    for (const transaction of file.transactions) {
      if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0 && !transaction.installments.length) unsupportedCaptureCount++;
      if (transaction.events.Payments > 0 && !transaction.installments.length) incompletePaymentTransactions.add(transaction.transactionId);
      if (affected(transaction) || transaction.installments.some(i => i.suspendedByChargeback)) affectedTransactions.add(transaction.transactionId);
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
      if (origins.size + payments.size > MAX_PERIOD_ROWS) failure("STONE_PERIOD_LIMIT", "O período excede o limite de parcelas. Consulte um período menor.", "EXPECTED_BUSINESS");
    }
  }
  const missingDates = expectedDates.filter(date => !observedDates.has(date));
  const rows: PeriodRow[] = [];
  for (const [key, captures] of origins) {
    const origin = captures[0];
    const item = origin.installment;
    const paid = payments.get(key) ?? [];
    const payment = paid[0];
    let reason: string | null = null;
    let status: PeriodRow["status"] = "needs_review";
    if (captures.length !== 1 || origin.transaction.events.Captures !== 1) reason = "Origens duplicadas ou múltiplos eventos de captura.";
    else if ((origin.transaction.installmentCount !== null && origin.transaction.installmentCount !== origin.transaction.installments.length) ||
      (origin.transaction.capturedAmount !== null && units(origin.transaction.capturedAmount) !== origin.transaction.installments.reduce((sum, i) => sum + units(i.grossAmount), BigInt(0)))) reason = "Parcelas da captura não fecham com a quantidade ou o bruto informado.";
    else if (saleDate(origin.transaction) !== origin.file.referenceDate || origin.transaction.currencyCode !== "986") reason = "Data de origem ou moeda incompleta/incompatível.";
    else if (affectedTransactions.has(origin.transaction.transactionId)) reason = "Cancelamento, contestação, suspensão ou reversão exige conferência.";
    else if (incompletePaymentTransactions.has(origin.transaction.transactionId)) reason = "Pagamento sinalizado sem detalhamento das parcelas.";
    else if (units(item.grossAmount) <= BigInt(0) || units(item.netAmount) < BigInt(0) || units(item.netAmount) > units(item.grossAmount) || !item.expectedPaymentDate || item.expectedPaymentDate < origin.file.referenceDate!) reason = "Valor ou vencimento original inválido/incompleto.";
    else if (paid.length) {
      const p = payment.installment;
      if (paid.length !== 1 || payment.transaction.events.Payments !== 1 || !p.paymentDate || p.paymentDate !== payment.file.referenceDate || !p.paymentId ||
        p.paymentDate < origin.file.referenceDate! || units(p.grossAmount) !== units(item.grossAmount) ||
        units(p.netAmount) < BigInt(0) || units(p.netAmount) > units(p.grossAmount) ||
        payment.transaction.currencyCode !== "986" || saleDate(payment.transaction) !== saleDate(origin.transaction) ||
        (p.advancedReceivableOriginalPaymentDate && p.advancedReceivableOriginalPaymentDate !== item.expectedPaymentDate)) {
        reason = "Pagamento parcial, duplicado ou incompatível; não calcular saldo por diferença.";
      } else status = p.paymentDate < item.expectedPaymentDate ? "paid_early" : "paid";
    } else if (paymentSignals.has(key)) reason = "Pagamento sinalizado sem evento de liquidação correspondente.";
    else if (missingDates.length) reason = "Há arquivos indisponíveis no período; pagamento posterior à captura não pôde ser descartado.";
    else status = item.expectedPaymentDate > period.through ? "projected" : "overdue_unconfirmed";
    rows.push({ transactionId: origin.transaction.transactionId, installment: item.number,
      saleDate: saleDate(origin.transaction), dueDate: item.expectedPaymentDate,
      gross: item.grossAmount, originalNet: item.netAmount, mdr: item.mdrAmount,
      paidNet: payment?.installment.netAmount ?? null, paymentDate: payment?.installment.paymentDate ?? null,
      paymentId: payment?.installment.paymentId ?? null, status, reason,
      sourceFileIds: [...new Set([...captures, ...paid].map(e => e.file.fileId))],
    });
  }
  rows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.transactionId.localeCompare(b.transactionId) || a.installment - b.installment);
  const count = (status: PeriodRow["status"]) => rows.filter(row => row.status === status).length;
  const pending = count("needs_review");
  const projected = rows.filter(row => row.status === "projected");
  const projectedNet = rows.length && !missingDates.length && !pending && !unsupportedCaptureCount
    ? decimal(projected.reduce((sum, row) => sum + units(row.originalNet), BigInt(0))) : null;
  return { period, rows, summary: { projectedCount: projected.length, projectedNet,
    paidEarlyCount: count("paid_early"), paidCount: count("paid"), pendingCount: pending,
    overdueUnconfirmedCount: count("overdue_unconfirmed"), unsupportedCaptureCount,
    paymentsOutsideCaptureCohort: [...payments.keys()].filter(key => !origins.has(key)).length },
  coverage: "capture_cohort_only_not_complete_portfolio" as const, missingDates,
  availableBalance: null, bankReceiptConfirmed: false as const, portfolioBalanceConfirmed: false as const,
  writesPerformed: false as const,
  files: files.map(file => ({ id: file.fileId, referenceDate: file.referenceDate, generatedAt: file.generatedAtProvider })),
  limitations: [
    "Somente vendas capturadas no período consultado; vendas anteriores e pagamentos sem origem nesse período não compõem a previsão.",
    "Previsão baseada nos eventos diários, não em posição consolidada da carteira. Registradora, cessões, gravames e ajustes fora desses eventos não foram apurados.",
    "Pago significa pagamento informado pela Stone, não crédito confirmado no extrato. Nenhuma baixa ou lançamento é realizado.",
    "O líquido original já contém descontos da origem; MDR e antecipação não são descontados novamente.",
  ] };
}

export async function queryReceivablePeriod(input: unknown, context: { isDefaultAdmin: boolean; workspace_id: string }, deps: {
  resolveMapping: (period: ReceivablePeriod, workspaceId: string) => Promise<FinancialAgentMapping>;
  read: (query: { stoneCode: string; referenceDate: string }) => Promise<string>;
  now?: Date;
}) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_PERIOD_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = receivablePeriodSchema.safeParse(input);
  if (!parsed.success) failure("STONE_PERIOD_INPUT", "Informe unidade, StoneCode e período válido de até 31 dias.", "VALIDATION");
  const period = parsed.data;
  const now = deps.now ?? new Date();
  if (period.through > latestPublishedDate(now)) failure("STONE_PERIOD_NOT_PUBLISHED", "O último dia precisa estar disponível após as 05h do dia seguinte (horário de Brasília).", "VALIDATION");
  const request: FinancialAgentRequest = { intent: "review_anticipations", kioskId: period.kioskId,
    stoneCode: period.stoneCode, referenceDate: period.through, prioritizeWithAi: false };
  const mapping = await deps.resolveMapping(period, context.workspace_id);
  resolveFinancialAgentMapping([mapping], request, context.workspace_id);
  if (mapping.validFrom > period.from) failure("STONE_PERIOD_MAPPING_RANGE", "O vínculo precisa cobrir todo o período. Não atribuímos vendas anteriores à vigência.", "EXPECTED_BUSINESS");
  const files: File[] = [];
  // Sequential reads bound memory and provider concurrency. Retain at most 5,000 events.
  let installmentEvents = 0;
  for (const referenceDate of periodDates(period)) {
    const scope = { stoneCode: period.stoneCode, referenceDate };
    try {
      const file = parseStoneAgendaXml(await deps.read(scope), scope);
      installmentEvents += file.transactions.reduce((sum, t) => sum + 1 + t.installments.length, 0);
      if (installmentEvents > MAX_PERIOD_ROWS) failure("STONE_PERIOD_LIMIT", "Reduza o período; limite de 5.000 eventos de parcelas atingido.", "EXPECTED_BUSINESS");
      files.push(file);
    } catch (error) {
      // Only transient retrieval failures become visible coverage gaps. Bad credentials,
      // mixed scope or malformed source must fail closed, never become an empty portfolio.
      if (!(error instanceof AppError) || !error.retryable || !["STONE_AGENDA_UNAVAILABLE", "STONE_AGENDA_UPSTREAM_REJECTED"].includes(error.code)) throw error;
    }
  }
  return { ...reviewReceivablePeriod(period, files), collectedAt: new Date().toISOString(),
    scope: { mappingId: mapping.id, kioskId: mapping.kioskId, accountId: mapping.accountId, stoneCode: period.stoneCode } };
}
export type ReceivablePeriodResult = Awaited<ReturnType<typeof queryReceivablePeriod>>;
