import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { latestPublishedDate } from "../receivables/period-review";
import {
  reconcileStoneReceipts,
  receiptReconciliationRequestSchema,
  type BankCreditFact,
  type ReceiptReconciliationResult,
  type StoneReceiptAdjustment,
  type StoneReceiptSettlement,
} from "./reconciliation";

const MAX_BANK_CREDITS = 1_000;
const ADJUSTMENT_EVENTS = [
  ["Cancellations", "cancellation"],
  ["CancellationCharges", "cancellation_charge"],
  ["Chargebacks", "chargeback"],
  ["ChargebackRefunds", "chargeback_refund"],
] as const;

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function datesBetween(from: string, through: string) {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function dateInBelem(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function asDate(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function eventAdjustments(transaction: ReturnType<typeof parseStoneAgendaXml>["transactions"][number]) {
  return ADJUSTMENT_EVENTS.flatMap(([event, kind]) => transaction.events[event] > 0
    ? [{ kind, count: transaction.events[event] } as StoneReceiptAdjustment]
    : []);
}

function extractSettlements(files: Array<ReturnType<typeof parseStoneAgendaXml>>) {
  const byId = new Map<string, StoneReceiptSettlement>();
  for (const file of files) {
    for (const transaction of file.transactions) {
      if (transaction.sourceSection !== "FinancialTransactionsAccounts" || transaction.events.Payments <= 0) continue;
      for (const installment of transaction.installments) {
        if (!installment.paymentDate || installment.paymentDate !== file.referenceDate) continue;
        const netAmount = Number(installment.netAmount);
        const grossAmount = Number(installment.grossAmount);
        if (!Number.isFinite(netAmount) || !Number.isFinite(grossAmount) || netAmount <= 0 || grossAmount <= 0) continue;
        const id = `${transaction.transactionId}:${installment.number}`;
        const next: StoneReceiptSettlement = {
          id,
          transactionId: transaction.transactionId,
          installment: installment.number,
          paymentId: installment.paymentId,
          paymentDate: installment.paymentDate,
          expectedPaymentDate: installment.expectedPaymentDate,
          saleDate: transaction.captureLocalDateTime
            ? `${transaction.captureLocalDateTime.slice(0, 4)}-${transaction.captureLocalDateTime.slice(4, 6)}-${transaction.captureLocalDateTime.slice(6, 8)}`
            : null,
          grossAmount,
          netAmount,
          paymentEventCount: transaction.events.Payments,
          sourceFileId: file.fileId,
          sourceReferenceDate: file.referenceDate,
          adjustments: eventAdjustments(transaction),
        };
        const previous = byId.get(id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
          throw new AppError({ code: "STONE_RECEIPT_REVISION_CONFLICT", kind: "DATA_INTEGRITY", safeMessage: "Há revisões conflitantes para uma liquidação Stone." });
        }
        byId.set(id, next);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.id.localeCompare(b.id));
}

async function readBankCredits(accountId: string, from: string, through: string): Promise<BankCreditFact[]> {
  const start = Timestamp.fromDate(new Date(`${from}T00:00:00-03:00`));
  const end = Timestamp.fromDate(new Date(`${addDays(through, 2)}T23:59:59-03:00`));
  const snapshot = await financialDbAdmin.collection("transactions")
    .where("accountId", "==", accountId)
    .where("direction", "==", "in")
    .where("date", ">=", start)
    .where("date", "<=", end)
    .limit(MAX_BANK_CREDITS + 1)
    .get();
  if (snapshot.size > MAX_BANK_CREDITS) {
    throw new AppError({ code: "STONE_RECEIPT_BANK_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Há créditos demais no recorte. Reduza o período antes de conferir." });
  }
  return snapshot.docs.flatMap(document => {
    const data = document.data();
    if (data.importedFrom !== "bank_statement" && data.importSource !== "inter_api") return [];
    const date = asDate(data.date);
    const amount = Number(data.amount);
    if (!date || !Number.isFinite(amount) || amount <= 0) return [];
    const references = Array.isArray(data.bankReferences)
      ? data.bankReferences.map(String).filter(Boolean)
      : [];
    return [{
      id: document.id,
      date: dateInBelem(date),
      amount,
      description: String(data.rawBankDescription || data.description || "Crédito bancário"),
      references,
      externalTransactionId: typeof data.externalTransactionId === "string" ? data.externalTransactionId : null,
    }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function transientStoneGap(error: unknown) {
  return error instanceof AppError && error.retryable && ["STONE_AGENDA_UNAVAILABLE", "STONE_AGENDA_UPSTREAM_REJECTED"].includes(error.code);
}

export async function queryStoneReceiptReconciliation(input: unknown, context: { isDefaultAdmin: boolean; workspace_id: string }, deps: {
  readStone?: (query: { stoneCode: string; referenceDate: string }, signal?: AbortSignal) => Promise<string>;
  readBank?: typeof readBankCredits;
  now?: Date;
}) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_RECEIPT_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = receiptReconciliationRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_RECEIPT_INPUT", kind: "VALIDATION", safeMessage: "Informe unidade, StoneCode e um período de até 31 dias." });
  const request = parsed.data;
  const now = deps.now ?? new Date();
  const latest = latestPublishedDate(now);
  if (request.through > latest) throw new AppError({ code: "STONE_RECEIPT_NOT_PUBLISHED", kind: "VALIDATION", safeMessage: "O último dia ainda não foi publicado pela Stone." });
  const mapping = await readReceivablePeriodMapping({ ...request }, context.workspace_id);
  if (mapping.workspaceId !== context.workspace_id || mapping.kioskId !== request.kioskId || !mapping.stoneCodes.includes(request.stoneCode)) {
    throw new AppError({ code: "STONE_RECEIPT_SCOPE", kind: "DATA_INTEGRITY" });
  }
  const signal = AbortSignal.timeout(110_000);
  const readStone = deps.readStone ?? ((query, readSignal) => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal: readSignal }));
  const files: Array<ReturnType<typeof parseStoneAgendaXml>> = [];
  const missingDates: string[] = [];
  for (const referenceDate of datesBetween(request.from, request.through)) {
    try {
      const scope = { stoneCode: request.stoneCode, referenceDate };
      files.push(parseStoneAgendaXml(await readStone(scope, signal), scope));
    } catch (error) {
      if (!transientStoneGap(error)) throw error;
      missingDates.push(referenceDate);
    }
  }
  const bankCredits = await (deps.readBank ?? readBankCredits)(mapping.accountId, request.from, request.through);
  const result: ReceiptReconciliationResult = reconcileStoneReceipts({
    settlements: extractSettlements(files),
    bankCredits,
    today: dateInBelem(now),
  });
  return {
    ...result,
    period: { from: request.from, through: request.through },
    collectedAt: now.toISOString(),
    scope: { workspaceId: context.workspace_id, mappingId: mapping.id, kioskId: mapping.kioskId, accountId: mapping.accountId, stoneCode: request.stoneCode },
    stoneCoverage: missingDates.length ? "partial" as const : "complete" as const,
    missingDates,
    files: files.map(file => ({ id: file.fileId, referenceDate: file.referenceDate, generatedAtProvider: file.generatedAtProvider })),
    limitations: missingDates.length
      ? [...result.limitations, `Arquivos Stone indisponíveis no recorte: ${missingDates.join(", ")}. A ausência não significa ausência de recebimento.`]
      : result.limitations,
  };
}
