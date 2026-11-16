import "server-only";

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
import { addDays, buildCashFlowStudy, HISTORY_DAYS, HORIZON_WEEKS, type StudyBatch, type StudyClosure, type StudyExpense, type StudyInputs, type StudyRealized, type StudyStoneParcel } from "./model";

/** Limites das consultas (custo registrado em docs/planos/plano-estudo-fluxo-caixa.md). */
export const STUDY_QUERY_LIMITS = { expensesPerStatus: 1_500, closures: 600, batches: 200, transactions: 3_000 } as const;

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
    depositStatus: row.cashDepositPolicy === "dre_only" ? "not_eligible" : text(deposit.status), depositEligibleCents: cents(deposit.eligibleCents),
  };
}

export function toStudyBatch(id: string, row: Row): StudyBatch {
  return {
    id, kioskId: text(row.kioskId), kioskName: text(row.kioskName) || text(row.kioskId), status: text(row.status),
    totalCents: cents(row.totalCents), periodStartDate: text(row.periodStartDate), periodEndDate: text(row.periodEndDate) || text(row.periodStartDate),
    issuedAt: text(row.issuedAt) || null, paidAt: text(row.paidAt) || null,
  };
}

export function toStudyExpense(id: string, row: Row): StudyExpense | null {
  if (!["pending", "partially_paid"].includes(text(row.status))) return null;
  const amount = Math.round(expenseCashForecastAmount(row as Parameters<typeof expenseCashForecastAmount>[0]) * 100);
  return {
    id, description: text(row.description) || "Despesa sem descrição", supplier: text(row.supplier) || null,
    date: dateKey(row.dueDate) ?? dateKey(row.competenceDate), amountCents: amount, provisioned: row.provisionType === "forecast",
  };
}

export function toStudyRealized(row: Row): StudyRealized | null {
  if (row.reversed === true || row.auditStatus === "reversed") return null;
  const date = dateKey(row.date);
  const amount = typeof row.amount === "number" ? Math.round(Math.abs(row.amount) * 100) : 0;
  const direction = row.direction === "in" || row.direction === "out" ? row.direction : null;
  return date && amount > 0 && direction ? { date, direction, amountCents: amount } : null;
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

async function loadInterBalance(): Promise<StudyInputs["interBalance"]> {
  try {
    return { cents: await getInterAvailableBalanceCents(), at: new Date().toISOString() };
  } catch {
    return null;
  }
}

function limited<T>(list: T[], limit: number, label: string, gaps: string[]) {
  if (list.length > limit) gaps.push(`Mais de ${limit} ${label}: a projeção usou só os primeiros.`);
  return list.slice(0, limit);
}

export async function loadCashFlowStudy(now = new Date()) {
  const today = financialDateKey(now)!;
  const gaps: string[] = [];
  const historyFrom = addDays(today, -HISTORY_DAYS - 7);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = monthStart.split("-").map(Number);
  const realizedFrom = new Date(Date.UTC(year, month - 4, 1, 3));
  const interAccountId = process.env.INTER_STATEMENT_BANK_ACCOUNT_ID?.trim() || process.env.INTER_COBRANCA_BANK_ACCOUNT_ID?.trim() || null;

  const [pending, partial, closures, batches, transactions, stone, interBalance] = await Promise.all([
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
    loadInterBalance(),
  ]);

  const recentClosures = closures.filter(closure => closure.date >= historyFrom);
  if (closures.length >= STUDY_QUERY_LIMITS.closures && recentClosures.length === closures.length) {
    gaps.push(`Mais de ${STUDY_QUERY_LIMITS.closures} fechamentos no período: a média de vendas usou só os mais recentes.`);
  }
  if (!interAccountId) gaps.push("A conta do Inter não está configurada; a aba Saúde fica sem o realizado.");
  if (stone.issue) gaps.push(stone.issue);
  const expenses = limited([...pending.docs, ...partial.docs], STUDY_QUERY_LIMITS.expensesPerStatus * 2, "despesas abertas", gaps)
    .flatMap(doc => toStudyExpense(doc.id, doc.data()) ?? []);
  const result = buildCashFlowStudy({
    today, interBalance, stone: stone.parcels,
    batches: batches.map(batch => toStudyBatch(batch.id, batch as unknown as Row)),
    closures: recentClosures.flatMap(closure => toStudyClosure(closure as unknown as Row) ?? []),
    expenses,
    realized: transactions ? limited(transactions.docs, STUDY_QUERY_LIMITS.transactions, "movimentações do Inter", gaps).flatMap(doc => toStudyRealized(doc.data()) ?? []) : [],
  });
  return { ...result, gaps: [...gaps, ...result.gaps], horizonWeeks: HORIZON_WEEKS, generatedAt: now.toISOString() };
}

export type CashFlowStudyPayload = Awaited<ReturnType<typeof loadCashFlowStudy>>;
