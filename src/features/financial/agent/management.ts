import { z } from "zod";
import { financialAgentIdentifier } from "./contracts";
import { calculateDreExpenses, type DreExpenseAccountMeta } from "../lib/dre-expense-calculation";
import { expenseReferencesResultCenter } from "../lib/expense-rateio";
import type { DreSourceDataPayload } from "../dre/source-data";
import type { ReceivablePeriodResult } from "../receivables/period-review";
import { exactSalesCents } from "../sales-reconciliation/validation";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";

export const managementRequestSchema = z.object({
  kioskId: financialAgentIdentifier, mappingId: financialAgentIdentifier,
  stoneCode: z.string().regex(/^[1-9]\d{0,19}$/),
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).refine(value => value >= FINANCIAL_DRE_START_MONTH_KEY),
  includeStone: z.boolean().default(false),
  budgetExpenseCents: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
  materialityCents: z.number().int().min(1).max(100_000_000_000).default(10_000),
}).strict();
export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export function managementPeriod(month: string) {
  const [year, number] = month.split("-").map(Number);
  return { from: `${month}-01`, through: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10),
    previous: new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7) };
}
export type CashEvidence = { id: string; date: string; amountCents: number; direction: "in" | "out";
  status: "bank_confirmed" | "reported" | "forecast"; expenseId: string | null };
export type ManagementCashSource = { movements: CashEvidence[]; excludedCount: number;
  confirmedBalance: { amountCents: number; confirmedAt: string; source: string } | null };
export const FEE_ACCOUNTS = { mdr: "ybXT1oSjyqDdtGPOsAti", anticipation: "9rYkpoScI5X2HC893bNj" } as const;

/** Reads canonical DRE expense rules; does not write a second accounting ledger. */
export function analyzeManagement(input: {
  request: ManagementRequest; source: DreSourceDataPayload;
  accounts: Record<string, DreExpenseAccountMeta>; centerName: string; centerNames: Record<string, string>;
  cash: ManagementCashSource; receivables: ReceivablePeriodResult | null;
}) {
  const { request, source } = input;
  const period = managementPeriod(request.month);
  const expenses = source.expenses.filter(expense => expenseReferencesResultCenter(expense, input.centerName, input.centerNames));
  const months = [period.previous, request.month].map(month => {
    const calculation = calculateDreExpenses({ expenses, accounts: input.accounts,
      monthKey: month, resultCenter: input.centerName, resultCenterNames: input.centerNames });
    const sales = source.salesSummaries.filter(row => row.kioskId === request.kioskId
      && `${row.year}-${String(row.month).padStart(2, "0")}` === month);
    const closure = source.closureSummaries.filter(row => row.kioskId === request.kioskId
      && `${row.year}-${String(row.month).padStart(2, "0")}` === month);
    const revenue = closure.length ? closure.reduce((sum, row) => sum + (row.dreRevenueTotalCents
      ?? row.expectedTotalCents + row.differenceTotalCents) / 100, 0)
      : sales.length ? sales.reduce((sum, row) => sum + row.revenue, 0) : null;
    const cmv = sales.length && !source.missingSimulationIds.length ? sales.reduce((sum, row) => sum + row.cmv, 0) : null;
    const at = (key: string) => calculation.totalsByPosition[key] ?? 0;
    // Same expense positions as the official DRE; CMV is computed separately.
    const expenseTotal = ["impostos_deducoes", "custos_variaveis", "pessoal", "despesas_operacionais",
      "ocupacao", "null", "despesas_financeiras", "despesa_nao_operacional", "impostos_resultado"]
      .reduce((sum, key) => sum + at(key), 0);
    const result = revenue !== null && cmv !== null && !calculation.issues.length
      ? revenue - cmv - expenseTotal + at("receita_financeira") + at("receita_nao_operacional") : null;
    const lines = Object.entries(calculation.detailsByPosition).flatMap(([position, details]) => details.map(row => ({
      expenseId: row.expenseId, accountId: row.accountPlanId, accountName: row.accountPlanName, position, amount: row.amount,
    }))).sort((a, b) => b.amount - a.amount);
    return { month, revenue, revenueBasis: closure.length ? "cash_closure" : "pdv", cmv,
      expenseTotal, result, margin: result !== null && revenue !== null && revenue > 0 ? result / revenue : null,
      positions: calculation.totalsByPosition, issues: calculation.issues, topExpenses: lines.slice(0, 20) };
  });
  const current = months[1]; const previous = months[0];
  const expenseChangeCents = previous.revenue !== null || expenses.some(row => row.competenceMonth === period.previous)
    ? Math.round((current.expenseTotal - previous.expenseTotal) * 100) : null;
  const budgetDifferenceCents = request.budgetExpenseCents === null ? null : Math.round(current.expenseTotal * 100) - request.budgetExpenseCents;
  const fees = (input.receivables?.rows ?? []).flatMap(row => {
    const mdr = exactSalesCents(row.mdr);
    const original = exactSalesCents(row.originalNet); const paid = exactSalesCents(row.paidNet);
    const anticipation = row.status === "paid_early" && original !== null && paid !== null && original >= paid ? original - paid : null;
    return ([{ kind: "mdr" as const, amount: mdr }, { kind: "anticipation" as const, amount: anticipation }])
      .filter(fee => fee.amount !== null && fee.amount > 0).map(fee => ({ transactionId: row.transactionId,
        installment: row.installment, kind: fee.kind, amountCents: fee.amount!,
        accountId: FEE_ACCOUNTS[fee.kind], accountName: input.accounts[FEE_ACCOUNTS[fee.kind]]?.name ?? null,
        sourceFileIds: row.sourceFileIds, status: "human_review_required" as const,
        basis: fee.kind === "mdr" ? "explicit_mdr" as const : "net_difference_not_classified" as const,
        sourcePending: row.status === "needs_review" || fee.kind === "anticipation", competence: row.saleDate?.slice(0, 7) ?? null }));
  });
  const confirmed = input.cash.movements.filter(row => row.status === "bank_confirmed");
  const outflows = input.cash.movements.filter(row => row.status === "forecast");
  const projected = (input.receivables?.rows ?? []).filter(row => row.status === "projected")
    .flatMap(row => { const cents = exactSalesCents(row.originalNet); return cents === null || !row.dueDate ? [] : [{
      id: `${row.transactionId}:${row.installment}`, date: row.dueDate, amountCents: cents,
    }]; });
  const cash = { ...input.cash, forecastReceivables: projected,
    bankInCents: confirmed.filter(row => row.direction === "in").reduce((sum, row) => sum + row.amountCents, 0),
    bankOutCents: confirmed.filter(row => row.direction === "out").reduce((sum, row) => sum + row.amountCents, 0),
    forecastOutCents: outflows.reduce((sum, row) => sum + row.amountCents, 0),
    forecastInCents: projected.reduce((sum, row) => sum + row.amountCents, 0),
    projectedBalanceCents: null, // Incomplete portfolio and account scope: never fabricate a closing balance.
  };
  const alerts: { code: string; severity: "high" | "review"; title: string; evidence: string; href: string }[] = [];
  if (current.issues.length) alerts.push({ code: "dre_quality", severity: "high", title: "Revisar classificação da DRE", evidence: `${current.issues.length} inconsistências contábeis`, href: "/dashboard/financial/dre" });
  if (budgetDifferenceCents !== null && budgetDifferenceCents >= request.materialityCents) alerts.push({ code: "budget", severity: "high", title: "Despesas acima do orçamento informado", evidence: `Desvio de ${budgetDifferenceCents} centavos`, href: "/dashboard/financial/dre" });
  if (expenseChangeCents !== null && expenseChangeCents >= request.materialityCents) alerts.push({ code: "history", severity: "review", title: "Investigar aumento de despesas", evidence: `Variação de ${expenseChangeCents} centavos versus ${period.previous}; comparar meses completos`, href: "/dashboard/financial/expenses" });
  if (fees.length) alerts.push({ code: "fees", severity: "review", title: "Conferir taxas e lançamentos existentes", evidence: `${fees.length} evidências; não lançar novamente sem conciliar a origem`, href: "/dashboard/financial/expenses" });
  if (!cash.confirmedBalance) alerts.push({ code: "balance", severity: "review", title: "Confirmar posição bancária", evidence: "Saldo não confirmado; não usar zero como saldo", href: "/dashboard/financial/cash-flow" });
  alerts.push({ code: "coverage", severity: "review", title: "Conferir cobertura de recebíveis", evidence: "Recorte de capturas não representa carteira integral", href: "/dashboard/financial/cash-flow/receivables" });
  return { months, fees, cash, alerts, expenseChangeCents, budgetDifferenceCents,
    coverage: "partial" as const, writesPerformed: false,
    limitations: ["DRE usa a fonte e regras oficiais, com CMV por composição; ausência de dados não comprova valor zero.",
      "Orçamento é parâmetro informado para esta análise, não um orçamento aprovado ou cadastro contábil.",
      "Histórico compara duas competências; mês em andamento não é diretamente comparável a mês encerrado.",
      "Fluxo reúne apenas movimentos da conta vinculada, despesas diretas e recebíveis do recorte. Rateios e outras contas podem faltar.",
      "Pagamento Stone não confirma crédito bancário. Taxas já incluídas no líquido não são descontadas novamente.",
      "Classificações de taxas são propostas com conta existente; não criam despesas, aprovações ou pagamentos."] };
}
export type ManagementAnalysis = ReturnType<typeof analyzeManagement>;
