import "server-only";

import { isCardPurchase } from "./card-forecast";
import { loadStudyCardForecast } from "./card-forecast.server";
import { loadStudyCashEvidence } from "./cash-evidence.server";
import { Timestamp } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { getInterAvailableBalanceCents } from "@/lib/integrations/inter/balance.server";
import { WORKSPACE_ID } from "@/lib/workspace";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { expenseCashForecastAmount } from "@/features/financial/lib/expense-display-state";
import { listEnabledStonePortfolioSources, readStonePortfolio } from "@/features/financial/receivables/portfolio-sync.server";
import { listCashClosures } from "@/features/financial/cash-closures/repository.server";
import { listCashDepositBatches } from "@/features/financial/cash-deposits/repository.server";
import { receivableItems } from "@/features/financial/receivables/receivable-view";
import type { StonePortfolioRow } from "@/features/financial/receivables/portfolio-projection";
import { addDays, BACKTEST_WEEKS, buildCashFlowStudy, HEALTH_MONTHS, HISTORY_DAYS, type StudyAccount, type StudyBatch, type StudyCategory, type StudyClosure, type StudyExpense, type StudyRealized, type StudyStoneParcel } from "./model";

/** Limites das consultas (custo registrado em docs/planos/plano-estudo-fluxo-caixa.md). */
/** `closures` é o teto do repositório (1.000); cobre os 90 dias da média mais as semanas do acerto. `chartOfAccounts` só resolve nomes de categoria. */
export const STUDY_QUERY_LIMITS = { expensesPerStatus: 1_500, closures: 1_000, batches: 200, transactions: 4_500, chartOfAccounts: 800 } as const;

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const cents = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0);
const dateKey = (value: unknown) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return financialDateKey(value);
};

export function toStudyClosure(row: Row): StudyClosure | null {
  const date = text(row.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text(row.kioskId)) return null;
  const channels = (row.expectedByChannelCents ?? {}) as Row;
  const deposit = (row.cashDeposit ?? {}) as Row;
  return {
    kioskId: text(row.kioskId), kioskName: text(row.kioskName) || text(row.kioskId), date, status: text(row.status),
    byChannelCents: { cash: cents(channels.cash), pix: cents(channels.pix), debit_card: cents(channels.debit_card), credit_card: cents(channels.credit_card) },
    operatorCount: typeof row.operatorCount === "number" ? row.operatorCount : undefined, countedCashCents: cents(row.countedCashCents), cashDepositPolicy: text(row.cashDepositPolicy),
    depositStatus: row.cashDepositPolicy === "dre_only" ? "not_eligible" : text(deposit.status), depositEligibleCents: cents(deposit.eligibleCents),
  };
}

export function toStudyBatch(id: string, row: Row): StudyBatch {
  return {
    id, workspaceId: text(row.workspaceId), kioskId: text(row.kioskId), kioskName: text(row.kioskName) || text(row.kioskId), status: text(row.status),
    totalCents: cents(row.totalCents), periodStartDate: text(row.periodStartDate), periodEndDate: text(row.periodEndDate) || text(row.periodStartDate),
    issuedAt: text(row.issuedAt) || null, paidAt: text(row.paidAt) || null,
    countingSessionId: text(row.countingSessionId) || null, interCobrancaId: text(row.interCobrancaId) || null, kioskIds: Array.isArray(row.kioskIds) ? row.kioskIds.filter((id): id is string => typeof id === "string") : undefined,
  };
}

const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});

/** Categoria do lançamento: plano de contas do próprio registro; o nome vem do registro ou do plano de contas. */
export function toStudyCategory(id: unknown, name: unknown, names?: ReadonlyMap<string, string>): StudyCategory | null {
  const categoryId = text(id) || null;
  const label = text(name) || (categoryId ? names?.get(categoryId) ?? "" : "");
  if (!categoryId && !label) return null;
  return { id: categoryId, name: label || "Categoria sem nome" };
}

export function toStudyExpense(id: string, row: Row, names?: ReadonlyMap<string, string>): StudyExpense | null {
  if (isCardPurchase(row) || row.sourceType === "CARD_STATEMENT" || row.obligationType === "CARD_STATEMENT") return null;
  if (!["pending", "partially_paid"].includes(text(row.status))) return null;
  const amount = Math.round(expenseCashForecastAmount(row as Parameters<typeof expenseCashForecastAmount>[0]) * 100);
  return {
    id, description: text(row.description) || "Despesa sem descrição", supplier: text(row.supplier) || null,
    date: dateKey(row.dueDate) ?? dateKey(row.competenceDate), amountCents: amount, provisioned: row.provisionType === "forecast",
    category: toStudyCategory(row.accountId || row.accountPlan, row.accountPlanName, names),
  };
}

export function toStudyRealized(row: Row, names?: ReadonlyMap<string, string>): StudyRealized | null {
  if (row.reversed === true || row.auditStatus === "reversed") return null;
  const date = dateKey(row.date);
  const amount = typeof row.amount === "number" ? Math.round(Math.abs(row.amount) * 100) : 0;
  const direction = row.direction === "in" || row.direction === "out" ? row.direction : null;
  const transfer = row.type === "transfer_in" || row.type === "transfer_out";
  return date && amount > 0 && direction ? { date, direction, amountCents: amount, transfer, cardPayment: Boolean(text(row.cardStatementId)), category: transfer ? null : toStudyCategory(row.accountPlanId, row.accountPlanName, names) } : null;
}

async function loadStone(): Promise<{ parcels: StudyStoneParcel[]; issue: string | null }> {
  try {
    const sources = await listEnabledStonePortfolioSources();
    const parcels: StudyStoneParcel[] = [];
    let stale = false;
    for (const source of sources) {
      const portfolio = await readStonePortfolio(source.stoneCode);
      if (portfolio.status !== "synchronized") { stale = true; continue; }
      if (portfolio.stale) stale = true;
      const rows = (portfolio as { rows?: StonePortfolioRow[] }).rows ?? [];
      for (const item of receivableItems(rows)) parcels.push({ dueDate: item.dueDate, grossCents: item.grossCents, netCents: item.netCents, feeCents: item.feeCents });
    }
    return { parcels, issue: stale ? "A carteira Stone não está atualizada até o último arquivo publicado." : null };
  } catch {
    return { parcels: [], issue: "Não foi possível ler a carteira Stone; os recebimentos de cartão ficaram fora." };
  }
}

/** Contas do estudo. Hoje só o Inter tem saldo por API; outras contas e a reserva entram aqui quando houver fonte. */
async function loadAccounts(interAccountId: string | null): Promise<StudyAccount[]> {
  const base = { id: interAccountId ?? "inter", name: "Inter · conta corrente", kind: "operating" as const };
  try {
    return [{ ...base, cents: await getInterAvailableBalanceCents(), at: new Date().toISOString() }];
  } catch {
    return [{ ...base, cents: null, at: null }];
  }
}

async function loadCategoryNames(): Promise<Map<string, string>> {
  try {
    const snapshot = await financialDbAdmin.collection("accounts").limit(STUDY_QUERY_LIMITS.chartOfAccounts).get();
    return new Map(snapshot.docs.flatMap(doc => { const name = text(asRow(doc.data()).name); return name ? [[doc.id, name] as [string, string]] : []; }));
  } catch {
    return new Map();
  }
}

function limited<T>(list: T[], limit: number, label: string, gaps: string[]) {
  if (list.length > limit) gaps.push(`Mais de ${limit} ${label}: a projeção usou só os primeiros.`);
  return list.slice(0, limit);
}

export async function loadCashFlowStudy(now = new Date()) {
  const today = financialDateKey(now)!;
  const gaps: string[] = [];
  // 90 dias da média + semanas do acerto + folga: o acerto compara cada semana com a média dos 90 dias anteriores a ela.
  const historyFrom = addDays(today, -HISTORY_DAYS - BACKTEST_WEEKS * 7 - 14);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = monthStart.split("-").map(Number);
  const realizedFrom = new Date(Date.UTC(year, month - 1 - HEALTH_MONTHS, 1, 3));
  const interAccountId = process.env.INTER_STATEMENT_BANK_ACCOUNT_ID?.trim() || process.env.INTER_COBRANCA_BANK_ACCOUNT_ID?.trim() || null;

  const [pending, partial, closures, batches, transactions, stone, accounts, categoryNames] = await Promise.all([
    financialDbAdmin.collection("expenses").where("status", "==", "pending").limit(STUDY_QUERY_LIMITS.expensesPerStatus + 1).get(),
    financialDbAdmin.collection("expenses").where("status", "==", "partially_paid").limit(STUDY_QUERY_LIMITS.expensesPerStatus + 1).get(),
    // Fechamentos mais recentes primeiro; o recorte de 97 dias é aplicado abaixo.
    listCashClosures({ workspaceId: WORKSPACE_ID, limit: STUDY_QUERY_LIMITS.closures }),
    listCashDepositBatches({ workspaceId: WORKSPACE_ID, limit: STUDY_QUERY_LIMITS.batches }),
    interAccountId
      ? financialDbAdmin.collection("transactions").where("accountId", "==", interAccountId).where("date", ">=", Timestamp.fromDate(realizedFrom))
        .orderBy("date", "asc").limit(STUDY_QUERY_LIMITS.transactions + 1).get()
      : Promise.resolve(null),
    loadStone(),
    loadAccounts(interAccountId),
    loadCategoryNames(),
  ]);

  const recentClosures = closures.filter(closure => closure.date >= historyFrom);
  if (closures.length >= STUDY_QUERY_LIMITS.closures && recentClosures.length === closures.length) {
    gaps.push(`Mais de ${STUDY_QUERY_LIMITS.closures} fechamentos no período: a média de vendas usou só os mais recentes.`);
  }
  if (!interAccountId) gaps.push("A conta do Inter não está configurada; as saídas recorrentes e a aba Saúde ficam sem o realizado.");
  if (stone.issue) gaps.push(stone.issue);
  const expenseDocs = limited([...pending.docs, ...partial.docs], STUDY_QUERY_LIMITS.expensesPerStatus * 2, "despesas abertas", gaps);
  const cardForecast = await loadStudyCardForecast(expenseDocs.map(doc => ({ id: doc.id, data: doc.data() })), today, pending.size <= STUDY_QUERY_LIMITS.expensesPerStatus && partial.size <= STUDY_QUERY_LIMITS.expensesPerStatus);
  gaps.push(...cardForecast.gaps);
  const expenses = [...expenseDocs.flatMap(doc => toStudyExpense(doc.id, doc.data(), categoryNames) ?? []), ...cardForecast.expenses];
  const studyBatches = batches.map(batch => toStudyBatch(batch.id, batch as unknown as Row));
  const cashEvidence = await loadStudyCashEvidence(studyBatches, historyFrom);
  gaps.push(...cashEvidence.gaps);
  const result = buildCashFlowStudy({
    today, accounts, stone: stone.parcels,
    batches: studyBatches, cashEvidence,
    closures: recentClosures.flatMap(closure => toStudyClosure(closure as unknown as Row) ?? []),
    expenses,
    realized: transactions ? limited(transactions.docs, STUDY_QUERY_LIMITS.transactions, "movimentações do Inter", gaps).flatMap(doc => toStudyRealized(doc.data(), categoryNames) ?? []) : [],
  });
  return { ...result, gaps: [...gaps, ...result.gaps], generatedAt: now.toISOString() };
}

export type CashFlowStudyPayload = Awaited<ReturnType<typeof loadCashFlowStudy>>;
