import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExpensesFlow, type ClosingCardStatementInput, type ClosingExpenseInput } from "../../src/features/financial/month-closing/expenses-flow";
import { indexExpenseBankTransactions } from "../../src/features/financial/obligations/expense-reconciliation";

const MONTH = "2026-10";
const TODAY = "2026-11-20";

const paidLinked = {
  status: "paid",
  settlementSummary: { paymentEvidenceStatus: "CONFIRMED", reconciliationStatus: "MATCHED" },
};

function run(expenses: ClosingExpenseInput[], cardStatements: ClosingCardStatementInput[] = [], canViewItems = true) {
  return evaluateExpensesFlow({ month: MONTH, today: TODAY, expenses, cardStatements, canViewItems });
}

const check = (result: ReturnType<typeof run>, id: string) => result.flow.checks.find((entry) => entry.id === id)!;

test("título pago e confirmado no extrato conta como conferido", () => {
  const result = run([{ id: "a", description: "Aluguel", totalValue: 1000, dueDate: "2026-10-05", ...paidLinked }]);
  assert.equal(check(result, "expenses.payments").state, "ok");
  assert.deepEqual([check(result, "expenses.payments").done, check(result, "expenses.payments").total], [1, 1]);
  assert.equal(result.totals.settledCents, 100000);
  assert.equal(result.flow.items.length, 0);
});

test("pago sem confirmação no extrato fica pendente e nunca vira conferido", () => {
  const result = run([{ id: "a", description: "Gás", totalValue: 135, dueDate: "2026-10-17", status: "paid" }]);
  assert.equal(check(result, "expenses.payments").state, "pending");
  assert.equal(result.flow.items[0].kind, "paid_without_bank_link");
  assert.equal(result.totals.settledCents, 0);
});

test("fechamento usa a mesma baixa bancária reconhecida no detalhe de Despesas", () => {
  const result = evaluateExpensesFlow({
    month: MONTH, today: TODAY, canViewItems: true, cardStatements: [],
    expenses: [
      { id: "legacy", status: "paid", totalValue: 100 },
      { id: "interest", status: "paid", totalValue: 2, type: "encargo", originExpenseId: "legacy",
        linkedBankTransactionId: "debit", evidenceSource: "BANK_STATEMENT" },
      { id: "unlinked", status: "paid", totalValue: 102 },
    ],
    bankTransactions: indexExpenseBankTransactions([{
      id: "debit", expenseId: "legacy", type: "expense", amount: 102, direction: "out",
      auditStatus: "resolved", importSource: "inter_api",
      obligationAllocations: [{ expenseId: "legacy", principalAmount: 100 }],
    }]),
  });
  const payments = check(result, "expenses.payments");
  assert.equal(payments.name, "Pagamentos conferidos");
  assert.deepEqual([payments.done, payments.total], [2, 3]);
  assert.equal(result.totals.settledCents, 10200);
  assert.deepEqual(result.flow.items.map(({ id }) => id), ["expense:unlinked"]);
});

test("pagamento só informado e pagamento divergente são pendências distintas", () => {
  const result = run([
    { id: "r", description: "Informado", totalValue: 10, dueDate: "2026-10-10", status: "paid", settlementSummary: { paymentEvidenceStatus: "REPORTED", reconciliationStatus: "NOT_FOUND" } },
    { id: "d", description: "Divergente", totalValue: 10, dueDate: "2026-10-10", status: "paid", settlementSummary: { paymentEvidenceStatus: "CONFIRMED", reconciliationStatus: "DIVERGENT" } },
  ]);
  const kinds = result.flow.items.map((entry) => entry.kind).sort();
  assert.deepEqual(kinds, ["payment_divergent", "payment_reported_only"]);
});

test("pago em dinheiro conta pela baixa do caixa, sem exigir extrato", () => {
  const result = run([{ id: "c", description: "Feira", totalValue: 80, dueDate: "2026-10-12", status: "paid", plannedPaymentMethodType: "cash" }]);
  assert.equal(check(result, "expenses.payments").state, "ok");
});

test("vencido e a vencer: vencido depende de você, a vencer aguarda a data", () => {
  const result = run([
    { id: "v", description: "Freezer", totalValue: 480, dueDate: "2026-11-14", status: "pending" },
    { id: "f", description: "Energia", totalValue: 612.4, dueDate: "2026-11-25", status: "pending" },
  ]);
  const byId = Object.fromEntries(result.flow.items.map((entry) => [entry.id, entry]));
  assert.equal(byId["expense:v"].kind, "overdue");
  assert.equal(byId["expense:v"].tone, "danger");
  assert.equal(byId["expense:f"].kind, "awaiting_due_date");
  assert.equal(result.totals.overdueCents, 48000);
  assert.equal(result.totals.openCents, 61240);
  assert.equal(result.flow.readyFrom, "2026-11-25");
  assert.equal(result.flow.items[0].id, "expense:v", "o vencido vem primeiro");
});

test("vence hoje ainda não é vencido", () => {
  const result = run([{ id: "h", description: "Hoje", totalValue: 50, dueDate: "2026-11-20", status: "pending" }]);
  assert.equal(result.flow.items[0].kind, "awaiting_due_date");
});

test("previsão sem valor real e rascunho pendem; previsão substituída conta como resolvida", () => {
  const result = run([
    { id: "das", description: "DAS 10/2026", totalValue: 3921.78, dueDate: "2026-11-23", status: "provisioned", provisionType: "forecast" },
    { id: "rasc", description: "Rascunho", totalValue: 10, status: "draft" },
    { id: "ok", description: "Previsão antiga", totalValue: 100, status: "reconciled", provisionType: "forecast" },
  ]);
  const forecasts = check(result, "expenses.forecasts");
  assert.equal(forecasts.state, "pending");
  assert.deepEqual([forecasts.done, forecasts.total], [1, 3]);
  assert.deepEqual(result.flow.items.map((entry) => entry.kind).sort(), ["draft", "forecast_without_actual"]);
});

test("cancelado, conciliado comum e itens ocultos da lista operacional são ignorados", () => {
  const result = run([
    { id: "x", description: "Cancelado", totalValue: 10, status: "cancelled", dueDate: "2026-10-01" },
    { id: "y", description: "Conciliado", totalValue: 10, status: "reconciled", dueDate: "2026-10-01" },
    { id: "z", description: "Oculto", totalValue: 10, status: "pending", dueDate: "2026-10-01", hiddenFromExpensePanel: true },
    { id: "m", description: "Migração", totalValue: 10, status: "pending", dueDate: "2026-10-01", budgetMigration: { id: 1 } },
  ]);
  assert.equal(result.flow.items.length, 0);
  assert.equal(result.totals.titleCount, 0);
});

test("compra no cartão é conferida pela fatura, não como título avulso", () => {
  const purchase = { id: "p", description: "Compra", totalValue: 90, dueDate: "2026-11-12", status: "pending", plannedPaymentMethodType: "credit_card" };
  const noStatement = run([purchase]);
  assert.equal(check(noStatement, "expenses.payments").total, 0);
  assert.equal(noStatement.flow.items[0].kind, "card_statement_missing");
  assert.equal(check(noStatement, "expenses.card").state, "pending");

  const paid = run([purchase], [{ id: "s1", monthKey: MONTH, status: "paid", dueDate: "2026-11-12", officialTotal: 90, paymentMethodLabel: "Inter" }]);
  assert.equal(check(paid, "expenses.card").state, "ok");
  assert.equal(paid.flow.items.length, 0);
});

test("fatura fechada aguarda pagamento; vencida depende de você; aberta pende", () => {
  const result = run([], [
    { id: "a", monthKey: MONTH, status: "closed", dueDate: "2026-11-25", officialTotal: 100, paymentMethodLabel: "A" },
    { id: "b", monthKey: MONTH, status: "closed", dueDate: "2026-11-12", officialTotal: 100, paymentMethodLabel: "B" },
    { id: "c", monthKey: MONTH, status: "pending", dueDate: "2026-11-30", officialTotal: 100, paymentMethodLabel: "C" },
    { id: "d", monthKey: "2026-09", status: "pending", dueDate: "2026-10-10", officialTotal: 100, paymentMethodLabel: "outra competência" },
  ]);
  assert.equal(result.flow.items.length, 3, "a fatura de outra competência não entra");
  assert.deepEqual(result.flow.items.map((entry) => entry.kind).sort(), ["card_statement_awaiting_payment", "card_statement_open", "card_statement_overdue"]);
});

test("o fluxo tem só três conferências e fica conferido quando tudo está conciliado", () => {
  const result = run([{ id: "a", description: "Aluguel", totalValue: 1000, dueDate: "2026-10-05", ...paidLinked }]);
  assert.deepEqual(result.flow.checks.map((entry) => entry.id), ["expenses.forecasts", "expenses.payments", "expenses.card"]);
  assert.equal(result.flow.state, "ok");
});

test("pendência real deixa o fluxo pendente", () => {
  const result = run([{ id: "v", description: "Freezer", totalValue: 480, dueDate: "2026-11-14", status: "pending" }]);
  assert.equal(result.flow.state, "pending");
});

test("sem permissão de despesas os itens ficam ocultos, mas as contagens permanecem", () => {
  const result = run([{ id: "v", description: "Freezer", totalValue: 480, dueDate: "2026-11-14", status: "pending" }], [], false);
  assert.equal(result.flow.items.length, 0);
  assert.equal(result.flow.itemsHidden, true);
  assert.equal(check(result, "expenses.payments").state, "pending");
});

test("os atalhos levam à tela de Despesas já filtrada e só a rotas internas", () => {
  const result = run([{ id: "v 1", description: "Freezer", totalValue: 480, dueDate: "2026-11-14", status: "pending" }]);
  const href = result.flow.items[0].href;
  assert.ok(href.startsWith("/dashboard/financial/expenses?"));
  const params = new URL(href, "https://local.test").searchParams;
  assert.equal(params.get("competence"), MONTH);
  assert.equal(params.get("expense"), "v 1");
});

test("competência sem despesas não é inventada: contagens zero e nenhum item", () => {
  const result = run([]);
  assert.equal(check(result, "expenses.payments").total, 0);
  assert.equal(result.flow.items.length, 0);
  assert.equal(result.totals.titleCount, 0);
});

test("despesa de liquidação (com sourceSettlement) não gera saldo em aberto no fechamento", () => {
  const result = run([{ id: "s", description: "Liquidação", totalValue: 100, dueDate: "2026-10-01", status: "pending", sourceSettlement: { id: "x" } }]);
  assert.equal(result.totals.overdueCents, 0);
});

test("data civil em texto não desloca de dia pelo fuso, e Timestamp do Firestore também funciona", () => {
  const text = run([{ id: "t", description: "Texto", totalValue: 10, dueDate: "2026-12-01", status: "pending" }]);
  assert.equal(text.flow.items[0].dueDate, "2026-12-01");
  const stamp = { toDate: () => new Date("2026-12-01T15:00:00Z") };
  const timestamp = run([{ id: "t", description: "Timestamp", totalValue: 10, dueDate: stamp, status: "pending" }]);
  assert.equal(timestamp.flow.items[0].dueDate, "2026-12-01");
});
