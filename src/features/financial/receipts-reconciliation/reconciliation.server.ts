import "server-only";

import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { stoneBrandName } from "@/lib/integrations/stone/stone-codes";
import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { latestPublishedDate } from "../receivables/period-review";
import { readStonePortfolio } from "../receivables/portfolio-sync.server";
import { readPixSalesSource } from "../sales-reconciliation/pix-source.server";
import { listDailySalesReviewCalendar, readDailySalesReviewSnapshot } from "../sales-reconciliation/review-state.server";
import type { PixSourceResult } from "../sales-reconciliation/pix-source";
import type { SalesMatchFact, SuggestedSalesReconciliationCase } from "../sales-reconciliation/types";
import {
  MAX_RECEIPT_PARCELS,
  belemTime,
  buildStoneAccountParcels,
  cardModality,
  cardSaleInstallments,
  receiptPeriodDates,
  stoneAccountRequestSchema,
  stoneDecimalCents,
  summarizeReceiptDays,
  summarizeReceiptGroups,
  type PixSettlementEvidence,
  type SaleAudit,
  type StoneAccountMonthRequest,
  type StoneAccountSaleRequest,
  type StonePortfolioParcel,
} from "./stone-account";

type StoneFile = ReturnType<typeof parseStoneAgendaXml>;
type Context = { isDefaultAdmin: boolean; workspace_id: string };
type Mapping = Awaited<ReturnType<typeof readReceivablePeriodMapping>>;
type DailySalesSnapshot = Awaited<ReturnType<typeof readDailySalesReviewSnapshot>>;
type Calendar = Awaited<ReturnType<typeof listDailySalesReviewCalendar>>;
type Portfolio = { mappingId: string; rows: StonePortfolioParcel[] } | null;

export type StoneAccountDependencies = {
  readStone?: (query: { stoneCode: string; referenceDate: string }, signal?: AbortSignal) => Promise<string>;
  readMapping?: (period: { kioskId: string; stoneCode: string; from: string; through: string }, workspaceId: string) => Promise<Mapping>;
  readPortfolio?: (stoneCode: string) => Promise<Portfolio>;
  readPix?: (scope: { workspaceId: string; kioskId: string; stoneCode: string; referenceDate: string }) => Promise<PixSourceResult>;
  readPdvCalendar?: typeof listDailySalesReviewCalendar;
  readPdvSnapshot?: (identity: Parameters<typeof readDailySalesReviewSnapshot>[0]) => Promise<DailySalesSnapshot>;
  now?: Date;
};

const MAX_SALE_PAYMENT_FILES = 13;
const decimal = z.string().regex(/^-?\d{1,15}(?:\.\d{1,12})?$/);
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const portfolioRowsSchema = z.array(z.object({
  transactionId: z.string().min(1).max(160), installment: z.number().int().min(1).max(99),
  saleDate: civilDate.nullable(), dueDate: civilDate.nullable(), gross: decimal, net: decimal,
  status: z.enum(["open", "paid", "review"]), paymentDate: civilDate.nullable(),
}).passthrough()).max(200_000) satisfies z.ZodType<StonePortfolioParcel[]>;

function transientStoneGap(error: unknown) {
  return error instanceof AppError && error.retryable && ["STONE_AGENDA_UNAVAILABLE", "STONE_AGENDA_UPSTREAM_REJECTED"].includes(error.code);
}

/** Carteira sincronizada: só vale se pertencer ao mesmo vínculo. Ausente não é erro, vira limitação. */
async function readPortfolioRows(stoneCode: string): Promise<Portfolio> {
  try {
    const portfolio = await readStonePortfolio(stoneCode);
    if (portfolio.status !== "synchronized") return null;
    const rows = portfolioRowsSchema.safeParse((portfolio as Record<string, unknown>).rows);
    const mappingId = (portfolio as Record<string, unknown>).mappingId;
    if (!rows.success || typeof mappingId !== "string") {
      throw new AppError({ code: "STONE_RECEIPT_PORTFOLIO_INVALID", kind: "DATA_INTEGRITY", safeMessage: "A carteira Stone salva está inválida. Sincronize a carteira antes de conferir." });
    }
    return { mappingId, rows: rows.data };
  } catch (error) {
    if (error instanceof AppError && error.code === "STONE_PORTFOLIO_SOURCE_MISSING") return null;
    throw error;
  }
}

function pixEvidence(source: PixSourceResult): PixSettlementEvidence[] {
  if (source.status !== "available") return [];
  const soldAt = new Map(source.facts.map(fact => [fact.identifiers.providerEventId ?? "", fact.soldAt]));
  return (source.feeEvidence ?? []).map(row => ({ ...row, soldAt: soldAt.get(row.eventId) ?? null }));
}

async function resolveScope(request: { kioskId: string; stoneCode: string }, from: string, through: string, context: Context, deps: StoneAccountDependencies) {
  const mapping = await (deps.readMapping ?? readReceivablePeriodMapping)({ kioskId: request.kioskId, stoneCode: request.stoneCode, from, through }, context.workspace_id);
  if (mapping.workspaceId !== context.workspace_id || mapping.kioskId !== request.kioskId || !mapping.stoneCodes.includes(request.stoneCode)) {
    throw new AppError({ code: "STONE_RECEIPT_SCOPE", kind: "DATA_INTEGRITY" });
  }
  return mapping;
}

async function readStoneFiles(stoneCode: string, dates: string[], deps: StoneAccountDependencies, signal: AbortSignal) {
  const readStone = deps.readStone ?? ((query, readSignal) => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal: readSignal }));
  const files: StoneFile[] = [];
  const missingDates: string[] = [];
  // Leitura sequencial: limita memória e concorrência no provedor, como na carteira.
  for (const referenceDate of dates) {
    try {
      const scope = { stoneCode, referenceDate };
      files.push(parseStoneAgendaXml(await readStone(scope, signal), scope));
    } catch (error) {
      if (!transientStoneGap(error)) throw error;
      missingDates.push(referenceDate);
    }
  }
  return { files, missingDates };
}

async function queryMonth(request: StoneAccountMonthRequest, context: Context, deps: StoneAccountDependencies) {
  const now = deps.now ?? new Date();
  const latest = latestPublishedDate(now);
  if (request.from > latest) throw new AppError({ code: "STONE_RECEIPT_NOT_PUBLISHED", kind: "VALIDATION", safeMessage: "O período ainda não foi publicado pela Stone." });
  const through = request.through > latest ? latest : request.through;
  const mapping = await resolveScope(request, request.from, through, context, deps);
  const dates = receiptPeriodDates(request.from, through);
  const signal = AbortSignal.timeout(110_000);
  const { files, missingDates } = await readStoneFiles(request.stoneCode, dates, deps, signal);
  const portfolio = await (deps.readPortfolio ?? readPortfolioRows)(request.stoneCode);
  const portfolioRows = portfolio && portfolio.mappingId === mapping.id ? portfolio.rows : null;
  const readPix = deps.readPix ?? readPixSalesSource;
  const pixSources = [] as Array<{ date: string; source: PixSourceResult }>;
  for (const referenceDate of dates) {
    pixSources.push({ date: referenceDate, source: await readPix({ workspaceId: context.workspace_id, kioskId: mapping.kioskId, stoneCode: request.stoneCode, referenceDate }) });
  }
  const calendar: Calendar = await (deps.readPdvCalendar ?? listDailySalesReviewCalendar)({
    workspaceId: context.workspace_id, kioskId: mapping.kioskId, mappingId: mapping.id, stoneCode: request.stoneCode,
    referenceDate: through, from: request.from, through,
  });
  const built = buildStoneAccountParcels({
    from: request.from, through, latestPublished: latest, files, missingDates, portfolio: portfolioRows,
    pix: pixSources.flatMap(row => pixEvidence(row.source)),
  });
  if (built.parcels.length > MAX_RECEIPT_PARCELS) {
    throw new AppError({ code: "STONE_RECEIPT_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "O período tem parcelas demais. Consulte um período menor." });
  }
  const days = summarizeReceiptDays(built.parcels, dates, missingDates);
  const groups = summarizeReceiptGroups(built.parcels, request.from, through, latest);
  const pixUnavailable = pixSources.filter(row => row.source.status !== "available").map(row => row.date);
  const pixPartial = pixSources.filter(row => row.source.status === "available" && row.source.coverage === "partial").map(row => row.date);
  const pdvAttention = calendar.reduce((sum, row) => sum + row.summary.attentionCount, 0);
  const limitations = [
    "Pago significa pagamento informado no arquivo diário de conciliação da Stone na conta Stone; o extrato da própria conta Stone ainda não está no sistema.",
    "A transferência do saldo da conta Stone para o Inter é a 2ª parte da conciliação e não entra nesta tela.",
    "Taxa praticada = MDR ÷ bruto. Sem tabela de taxas contratadas, diferença de taxa é ponto a conferir, não cobrança a maior.",
    ...(portfolioRows ? [] : ["Carteira Stone não sincronizada para este vínculo: a previsão de vendas anteriores ao período não aparece; só os pagamentos efetivos e as vendas do período."]),
    ...(missingDates.length ? [`Arquivos Stone indisponíveis: ${missingDates.join(", ")}. A ausência não significa ausência de pagamento.`] : []),
    ...(pixUnavailable.length ? [`Pix sem arquivo processado em ${pixUnavailable.length} dia(s): ${pixUnavailable.join(", ")}.`] : []),
    ...(pixPartial.length ? [`Pix com cobertura parcial em ${pixPartial.join(", ")}: registros sem evidência suficiente ficaram de fora.`] : []),
    ...(built.conflictCount ? [`${built.conflictCount} parcela(s) com informações conflitantes entre arquivos ficaram para conferência.`] : []),
  ];
  return {
    view: "month" as const,
    period: { from: request.from, through, requestedThrough: request.through },
    latestPublished: latest,
    collectedAt: now.toISOString(),
    scope: { workspaceId: context.workspace_id, mappingId: mapping.id, kioskId: mapping.kioskId, stoneCode: request.stoneCode },
    coverage: {
      stone: missingDates.length ? "partial" as const : "complete" as const,
      missingDates,
      portfolio: portfolioRows ? "synchronized" as const : "not_synchronized" as const,
      pixUnavailableDates: pixUnavailable,
      pixPartialDates: pixPartial,
      pdvRecordedDays: calendar.length,
      pdvAttentionCount: pdvAttention,
    },
    parcels: built.parcels,
    days,
    groups,
    files: files.map(file => ({ id: file.fileId, referenceDate: file.referenceDate, generatedAtProvider: file.generatedAtProvider })),
    limitations,
    writesPerformed: false as const,
  };
}

function pdvSide(snapshot: DailySalesSnapshot, match: (fact: SalesMatchFact) => boolean): SaleAudit["pdv"] {
  if (!snapshot) return { review: "not_recorded", reviewStatus: null, caseKind: null, matchBasis: null, confidence: null, coupons: [] };
  const stoneFacts = (snapshot.stoneSales as SalesMatchFact[]).filter(match);
  const cases = snapshot.cases as SuggestedSalesReconciliationCase[];
  const found = cases.find(row => stoneFacts.some(fact => row.stoneSaleIds.includes(fact.id))) ?? null;
  const pdvFacts = snapshot.pdvFacts as SalesMatchFact[];
  const coupons = found ? pdvFacts.filter(fact => found.pdvFactIds.includes(fact.id)) : [];
  return {
    review: "recorded",
    reviewStatus: snapshot.review.status,
    caseKind: found?.kind ?? (stoneFacts.length ? "stone_only" : null),
    matchBasis: found?.matchBasis ?? null,
    confidence: found?.confidence ?? null,
    coupons: coupons.map(fact => ({
      couponId: fact.couponId ?? null, soldAt: fact.soldAt, channel: fact.channel, grossCents: fact.grossAmountCents,
      status: fact.status, nsu: fact.identifiers.nsu ?? null, authorizationCode: fact.identifiers.authorizationCode ?? null,
      terminalId: fact.identifiers.terminalId ?? null, merchantOrderId: fact.identifiers.merchantOrderId ?? null,
    })),
  };
}

async function querySale(request: StoneAccountSaleRequest, context: Context, deps: StoneAccountDependencies): Promise<{ view: "sale"; audit: SaleAudit; collectedAt: string }> {
  const now = deps.now ?? new Date();
  const latest = latestPublishedDate(now);
  if (request.saleDate > latest) throw new AppError({ code: "STONE_RECEIPT_NOT_PUBLISHED", kind: "VALIDATION", safeMessage: "O dia da venda ainda não foi publicado pela Stone." });
  const mapping = await resolveScope(request, request.saleDate, request.saleDate, context, deps);
  const identity = { workspaceId: context.workspace_id, kioskId: mapping.kioskId, mappingId: mapping.id, stoneCode: request.stoneCode, referenceDate: request.saleDate };
  const snapshot = await (deps.readPdvSnapshot ?? readDailySalesReviewSnapshot)(identity);
  const base = { source: request.source, saleId: request.saleId, saleDate: request.saleDate, kioskId: mapping.kioskId, stoneCode: request.stoneCode };

  if (request.source === "pix") {
    const source = await (deps.readPix ?? readPixSalesSource)({ workspaceId: context.workspace_id, kioskId: mapping.kioskId, stoneCode: request.stoneCode, referenceDate: request.saleDate });
    const evidence = pixEvidence(source).find(row => row.eventId === request.saleId);
    if (!evidence) throw new AppError({ code: "STONE_RECEIPT_SALE_NOT_FOUND", kind: "EXPECTED_BUSINESS", safeMessage: "Venda Pix não encontrada no arquivo do dia." });
    const settled = evidence.settledOn <= latest ? evidence.settledOn : null;
    return { view: "sale", collectedAt: now.toISOString(), audit: { ...base,
      stone: { transactionId: null, e2eId: evidence.e2eId, eventId: evidence.eventId, captureLocalDateTime: null, saleTime: belemTime(evidence.soldAt),
        authorizationDateTimeUtc: evidence.soldAt, brandCode: null, brand: null, accountTypeCode: null, feeTypeCode: null, modality: "pix",
        installmentCount: 1, capturedCents: evidence.grossCents, canceledCents: 0, events: {}, originFile: source.fileId ? { id: source.fileId, referenceDate: request.saleDate, generatedAt: "" } : null },
      installments: [{ number: 1, grossCents: evidence.grossCents, feeCents: evidence.feeCents, feeSource: "stone", anticipationCents: null,
        netCents: evidence.grossCents - evidence.feeCents, expectedDate: evidence.soldOn, originalDate: null, paidDate: settled,
        paymentId: null, paymentEventCount: settled ? 1 : 0, suspendedByChargeback: false,
        file: source.fileId ? { id: source.fileId, referenceDate: request.saleDate, generatedAt: "" } : null,
        status: settled ? "paid" : "to_receive" }],
      pdv: pdvSide(snapshot, fact => fact.channel === "pix" && fact.identifiers.providerEventId === request.saleId),
    } };
  }

  const signal = AbortSignal.timeout(110_000);
  const originRead = await readStoneFiles(request.stoneCode, [request.saleDate], deps, signal);
  const originFile = originRead.files[0] ?? null;
  const origin = originFile?.transactions.find(row => row.sourceSection === "FinancialTransactions" && row.transactionId === request.saleId) ?? null;
  const portfolio = await (deps.readPortfolio ?? readPortfolioRows)(request.stoneCode);
  const portfolioRows = portfolio && portfolio.mappingId === mapping.id ? portfolio.rows.filter(row => row.transactionId === request.saleId) : [];
  if (!origin && !portfolioRows.length) throw new AppError({ code: "STONE_RECEIPT_SALE_NOT_FOUND", kind: "EXPECTED_BUSINESS", safeMessage: "Venda não encontrada no arquivo Stone do dia." });
  // Arquivos dos dias de pagamento: data paga pela carteira ou, sem ela, a data prevista.
  const paymentDates = [...new Set([
    ...portfolioRows.flatMap(row => row.paymentDate ? [row.paymentDate] : []),
    ...(origin?.installments ?? []).flatMap(row => row.expectedPaymentDate && row.expectedPaymentDate <= latest ? [row.expectedPaymentDate] : []),
  ])].filter(date => date > request.saleDate || date === request.saleDate).sort().slice(0, MAX_SALE_PAYMENT_FILES);
  const paymentRead = await readStoneFiles(request.stoneCode, paymentDates, deps, signal);
  const payments = paymentRead.files.flatMap(file => file.transactions
    .filter(row => row.sourceSection === "FinancialTransactionsAccounts" && row.transactionId === request.saleId && row.events.Payments > 0)
    .flatMap(transaction => transaction.installments
      .filter(installment => installment.paymentDate === file.referenceDate)
      .map(installment => ({ file, transaction, installment }))));
  const reference = origin ?? payments[0]?.transaction ?? null;
  return { view: "sale", collectedAt: now.toISOString(), audit: { ...base,
    stone: {
      transactionId: request.saleId, e2eId: null, eventId: null,
      captureLocalDateTime: reference?.captureLocalDateTime ?? null,
      saleTime: reference?.captureLocalDateTime ? `${reference.captureLocalDateTime.slice(8, 10)}:${reference.captureLocalDateTime.slice(10, 12)}:${reference.captureLocalDateTime.slice(12, 14)}` : null,
      authorizationDateTimeUtc: reference?.authorizationDateTimeUtc ?? null,
      brandCode: reference?.brandCode ?? null, brand: reference ? stoneBrandName(reference.brandCode) : null,
      accountTypeCode: reference?.accountTypeCode ?? null, feeTypeCode: reference?.feeTypeCode ?? null,
      modality: reference ? cardModality(reference) : "other",
      installmentCount: reference?.installmentCount ?? (origin?.installments.length || portfolioRows.length || 1),
      capturedCents: stoneDecimalCents(origin?.capturedAmount ?? reference?.capturedAmount),
      canceledCents: stoneDecimalCents(origin?.canceledAmount ?? reference?.canceledAmount) ?? 0,
      events: Object.fromEntries(Object.entries(origin?.events ?? {}).map(([key, value]) => [key, value])),
      originFile: originFile ? { id: originFile.fileId, referenceDate: originFile.referenceDate, generatedAt: originFile.generatedAtProvider } : null,
    },
    installments: cardSaleInstallments({ origin, payments, portfolio: portfolioRows, latestPublished: latest,
      missingDates: [...originRead.missingDates, ...paymentRead.missingDates] }),
    pdv: pdvSide(snapshot, fact => fact.channel !== "pix" && (fact.id === request.saleId || fact.identifiers.providerTransactionId === request.saleId)),
  } };
}

/**
 * Conciliação de recebimentos, 1ª parte: venda Pix/cartão → pagamento na conta Stone.
 * Somente leitura, restrita ao administrador padrão; o vínculo oficial define unidade e StoneCode.
 */
export async function queryStoneReceiptReconciliation(input: unknown, context: Context, deps: StoneAccountDependencies) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_RECEIPT_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = stoneAccountRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_RECEIPT_INPUT", kind: "VALIDATION", safeMessage: "Informe unidade, StoneCode e um período de até 31 dias." });
  return parsed.data.view === "sale" ? querySale(parsed.data, context, deps) : queryMonth(parsed.data, context, deps);
}

export type StoneAccountMonthResult = Awaited<ReturnType<typeof queryMonth>>;
export type StoneAccountSaleResult = Awaited<ReturnType<typeof querySale>>;
