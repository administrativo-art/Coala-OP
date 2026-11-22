import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import {
  financialExpenseChargePeriods,
  financialExpenseInstallmentCharges,
  financialInstallmentDisplayFields,
  type FinancialExpenseChargeSource,
} from "@/features/financial/lib/expense-accounting-contract";
import {
  expenseDisplayAmounts,
  expenseDisplayStatus,
  expenseHasOverdueBalance,
} from "@/features/financial/lib/expense-display-state";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import {
  resolveExpenseReconciliation,
  type ExpenseReconciliationSource,
  type indexExpenseBankTransactions,
} from "@/features/financial/obligations/expense-reconciliation";

import type {
  ClosingCheck,
  ClosingFlow,
  ClosingItem,
  ClosingItemKind,
  ExpensesTotals,
} from "./types";

/** Campos de uma despesa usados pelo fechamento. Valores desconhecidos nunca viram "conferido". */
export type ClosingExpenseInput = ExpenseReconciliationSource & FinancialExpenseChargeSource & {
  description?: unknown;
  supplier?: unknown;
  totalValue?: unknown;
  paymentState?: unknown;
  hiddenFromExpensePanel?: unknown;
  budgetMigration?: unknown;
  originModule?: unknown;
  originStatus?: unknown;
  settlementSummary?: unknown;
  sourceSettlement?: unknown;
};

export type ClosingCardStatementInput = {
  id: string;
  monthKey?: unknown;
  status?: unknown;
  dueDate?: unknown;
  officialTotal?: unknown;
  paymentMethodLabel?: unknown;
  accountId?: unknown;
  paymentMethodId?: unknown;
};

export type ExpensesFlowInput = {
  month: string;
  /** `AAAA-MM-DD` no fuso do negócio. */
  today: string;
  expenses: ClosingExpenseInput[];
  cardStatements: ClosingCardStatementInput[];
  canViewItems: boolean;
  bankTransactions?: ReturnType<typeof indexExpenseBankTransactions>;
};

const CHECK_FORECASTS = "expenses.forecasts";
const CHECK_PAYMENTS = "expenses.payments";
const CHECK_CARD = "expenses.card";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown) => Math.round((Number(value) || 0) * 100);
/** Data civil em texto (`AAAA-MM-DD`) já é o dia; converter pelo fuso a deslocaria para o dia anterior. */
const dateKey = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : financialDateKey(value);

function expenseHref(month: string, id: string, installment?: number) {
  const params = new URLSearchParams({ competence: month, expense: id });
  if (installment !== undefined) params.set("installment", String(installment));
  return `${FINANCIAL_ROUTES.expenses}?${params}`;
}

function overdueListHref(month: string) {
  const params = new URLSearchParams({ competence: month, status: "overdue" });
  return `${FINANCIAL_ROUTES.expenses}?${params}`;
}

function cardStatementHref(month: string, statement?: ClosingCardStatementInput) {
  const params = new URLSearchParams({ month });
  if (statement && text(statement.accountId)) params.set("accountId", text(statement.accountId));
  if (statement && text(statement.paymentMethodId)) params.set("paymentMethodId", text(statement.paymentMethodId));
  return `${FINANCIAL_ROUTES.cardStatements}?${params}`;
}

function titleOf(expense: ClosingExpenseInput) {
  return text(expense.description) || "Despesa sem descrição";
}

function detailOf(expense: ClosingExpenseInput, suffix: string) {
  const supplier = text(expense.supplier);
  return supplier ? `${supplier} · ${suffix}` : suffix;
}

type Settlement = { paymentEvidenceStatus?: string; reconciliationStatus?: string } | null;

function settlementOf(expense: ClosingExpenseInput): Settlement {
  const value = expense.settlementSummary;
  return value && typeof value === "object" ? (value as Settlement) : null;
}

function item(
  base: Omit<ClosingItem, "tone" | "checkId"> & { kind: ClosingItemKind; checkId: string },
  tone: ClosingItem["tone"],
): ClosingItem {
  return { ...base, tone };
}

function sortItems(items: ClosingItem[]) {
  const rank = (entry: ClosingItem) => (entry.tone === "danger" ? 0 : entry.dueDate ? 1 : 2);
  return [...items].sort((left, right) =>
    rank(left) - rank(right)
    || (left.dueDate ?? "9999-99-99").localeCompare(right.dueDate ?? "9999-99-99")
    || left.title.localeCompare(right.title, "pt-BR"));
}

export function expensesForCompetence(input: Pick<ExpensesFlowInput, "expenses" | "cardStatements" | "month">) {
  return input.expenses.flatMap((expense) => {
    const installments = financialExpenseInstallmentCharges(expense);
    if (!installments) {
      return financialExpenseChargePeriods(expense, input.cardStatements)
        .some((period) => period.competenceMonth === input.month) ? [expense] : [];
    }
    const title = { ...expense };
    delete title.sourceSettlement;
    return installments.filter((charge) => charge.competenceMonth === input.month).map((charge) => ({
      ...title,
      ...financialInstallmentDisplayFields(charge),
      reconciliationInstallmentNumber: charge.number,
      linkedBankTransactionId: charge.bankTransactionId,
      linkedBankTransactionIds: undefined,
      netPayableValue: undefined,
    }));
  });
}

export function evaluateExpensesFlow(input: ExpensesFlowInput): { flow: ClosingFlow; totals: ExpensesTotals } {
  const { month, today } = input;
  const items: ClosingItem[] = [];
  const now = new Date(`${today}T12:00:00-03:00`);

  let forecastDone = 0;
  let forecastPending = 0;
  let paymentsTotal = 0;
  let paymentsDone = 0;
  const totals: ExpensesTotals = { titleCount: 0, titlesCents: 0, settledCents: 0, unconfirmedCents: 0, openCents: 0, overdueCents: 0 };
  let cardExpenseCount = 0;

  for (const expense of expensesForCompetence(input)) {
    const status = text(expense.status);
    const isForecast = expense.provisionType === "forecast";
    // Mesmas exclusões da lista operacional de Despesas.
    if (expense.hiddenFromExpensePanel || (expense.budgetMigration && status !== "cancelled")) continue;
    if (status === "cancelled") continue;

    if (status === "reconciled") {
      if (isForecast) forecastDone += 1; // previsão já substituída pelo valor real
      continue;
    }
    if (status === "draft") {
      forecastPending += 1;
      items.push(item({
        id: `expense:${expense.id}`, checkId: CHECK_FORECASTS, kind: "draft", title: titleOf(expense),
        detail: detailOf(expense, "Rascunho ainda não lançado"), dueDate: dateKey(expense.dueDate),
        amountCents: cents(expense.totalValue), href: expenseHref(month, expense.id),
      }, "warn"));
      continue;
    }
    if (isForecast && status !== "paid") {
      forecastPending += 1;
      items.push(item({
        id: `expense:${expense.id}`, checkId: CHECK_FORECASTS, kind: "forecast_without_actual", title: titleOf(expense),
        detail: detailOf(expense, "Previsão sem o valor real"), dueDate: dateKey(expense.dueDate),
        amountCents: cents(expense.totalValue), href: expenseHref(month, expense.id),
      }, "warn"));
      continue;
    }
    if (expense.plannedPaymentMethodType === "credit_card") {
      cardExpenseCount += 1; // conferido pela fatura, não como título avulso
      continue;
    }

    paymentsTotal += 1;
    totals.titleCount += 1;
    const total = cents(expense.totalValue);
    totals.titlesCents += total;
    const state = {
      status, paymentState: text(expense.paymentState) || undefined, provisionType: text(expense.provisionType) || undefined,
      originModule: text(expense.originModule) || undefined, originStatus: text(expense.originStatus) || undefined,
      dueDate: expense.dueDate, totalValue: Number(expense.totalValue) || 0,
      installments: Array.isArray(expense.installments) ? expense.installments : undefined,
      settlementSummary: settlementOf(expense) as never,
      // `expenseCashForecastAmount` trata a simples presença da chave como "despesa de liquidação": só repassar se existir.
      ...(Object.prototype.hasOwnProperty.call(expense, "sourceSettlement") ? { sourceSettlement: expense.sourceSettlement } : {}),
    };
    const display = expenseDisplayStatus(state as never, now);
    const reconciliation = resolveExpenseReconciliation(expense, input.bankTransactions);
    const due = dateKey(expense.dueDate);
    const part = expense.reconciliationInstallmentNumber;
    const base = {
      id: part === undefined ? `expense:${expense.id}` : `expense:${expense.id}:installment:${part}`,
      checkId: CHECK_PAYMENTS,
      title: part === undefined ? titleOf(expense) : `${titleOf(expense)} · Parcela ${part}`,
      dueDate: due,
      amountCents: total,
      href: expenseHref(month, expense.id, part),
    };

    // Cada título cai em uma só faixa (conferido, sem conferência, a vencer ou vencido): a soma sempre fecha com o total.
    if (reconciliation === "pending_document") {
      totals.unconfirmedCents += total;
      items.push(item({ ...base, kind: "payment_without_document", detail: detailOf(expense, "Pagamento encontrado no extrato, falta o documento") }, "warn"));
      continue;
    }
    if (reconciliation === "reported" && (status === "paid" || display === "reported_paid")) {
      totals.unconfirmedCents += total;
      items.push(item({ ...base, kind: "payment_reported_only", detail: detailOf(expense, "Pagamento informado, ainda sem confirmação no extrato") }, "warn"));
      continue;
    }
    if (reconciliation === "divergent") {
      totals.unconfirmedCents += total;
      items.push(item({ ...base, kind: "payment_divergent", detail: detailOf(expense, "O pagamento no extrato diverge do valor do título") }, "danger"));
      continue;
    }
    if (status === "paid") {
      if (reconciliation === "bank" || reconciliation === "cash") {
        paymentsDone += 1;
        totals.settledCents += total;
      } else {
        totals.unconfirmedCents += total;
        items.push(item({ ...base, kind: "paid_without_bank_link", detail: detailOf(expense, "Marcada como paga, sem pagamento vinculado no extrato") }, "warn"));
      }
      continue;
    }

    // Título em aberto: pendente ou parcialmente pago.
    const open = Math.round(expenseDisplayAmounts(state as never).open * 100);
    totals.unconfirmedCents += total - open; // parte já paga de um título parcialmente pago
    if (expenseHasOverdueBalance(state as never, now)) {
      totals.overdueCents += open;
      items.push(item({ ...base, amountCents: open, kind: "overdue", detail: detailOf(expense, "Vencida e sem pagamento vinculado") }, "danger"));
    } else if (due) {
      totals.openCents += open;
      items.push(item({ ...base, amountCents: open, kind: "awaiting_due_date", detail: detailOf(expense, display === "scheduled" ? "Pagamento agendado" : "Ainda não venceu") }, "warn"));
    } else {
      totals.openCents += open;
      items.push(item({ ...base, amountCents: open, kind: "no_due_date", detail: detailOf(expense, "Sem data de vencimento") }, "warn"));
    }
  }

  // Faturas de cartão da competência.
  const statements = input.cardStatements.filter((statement) => text(statement.monthKey) === month);
  let cardDone = 0;
  let cardTotal = statements.length;
  for (const statement of statements) {
    const status = text(statement.status);
    const due = dateKey(statement.dueDate);
    const label = text(statement.paymentMethodLabel) || "Cartão";
    const base = {
      id: `card-statement:${statement.id}`, checkId: CHECK_CARD, title: `Fatura do ${label}`, dueDate: due,
      amountCents: cents(statement.officialTotal), href: cardStatementHref(month, statement),
    };
    if (status === "paid") {
      cardDone += 1;
    } else if (status === "closed") {
      const late = Boolean(due && due < today);
      items.push(item({ ...base, kind: late ? "card_statement_overdue" : "card_statement_awaiting_payment", detail: late ? "Fechada e vencida, sem pagamento vinculado" : "Fechada, aguardando o pagamento" }, late ? "danger" : "warn"));
    } else {
      items.push(item({ ...base, kind: "card_statement_open", detail: "Fatura ainda não fechada" }, "warn"));
    }
  }
  if (cardExpenseCount > 0 && statements.length === 0) {
    cardTotal = 1;
    items.push(item({
      id: `card-statement:missing:${month}`, checkId: CHECK_CARD, kind: "card_statement_missing", title: "Fatura do cartão",
      detail: `${cardExpenseCount} compra(s) no cartão e nenhuma fatura importada para a competência`, dueDate: null,
      amountCents: null, href: cardStatementHref(month),
    }, "warn"));
  }

  const pendingOf = (checkId: string) => items.some((entry) => entry.checkId === checkId);
  const checks: ClosingCheck[] = [
    {
      id: CHECK_FORECASTS, name: "Previsões e rascunhos resolvidos",
      state: pendingOf(CHECK_FORECASTS) ? "pending" : "ok",
      done: forecastDone, total: forecastDone + forecastPending,
    },
    {
      id: CHECK_PAYMENTS, name: "Pagamentos conferidos",
      state: pendingOf(CHECK_PAYMENTS) ? "pending" : "ok", done: paymentsDone, total: paymentsTotal,
      note: "Pagas em dinheiro contam pela baixa do fechamento de caixa.",
    },
    {
      id: CHECK_CARD, name: "Fatura do cartão",
      state: pendingOf(CHECK_CARD) ? "pending" : "ok", done: cardDone, total: cardTotal,
    },
  ];

  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  const selfResolving = items.filter((entry) => entry.kind === "awaiting_due_date" || entry.kind === "card_statement_awaiting_payment");
  const readyFrom = selfResolving.reduce<string | null>((latest, entry) => (entry.dueDate && (!latest || entry.dueDate > latest) ? entry.dueDate : latest), null);

  return {
    totals,
    flow: {
      key: "expenses", name: "Despesas", state, checks,
      items: input.canViewItems ? sortItems(items) : [],
      itemsHidden: !input.canViewItems && items.length > 0,
      readyFrom,
    },
  };
}

export { overdueListHref };
