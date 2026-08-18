import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCardStatementAllocations,
  buildCardStatementGroups,
  findCardStatementPaymentCandidates,
  resolveCardStatementCycle,
  resolveCardStatementCycleFromMonth,
  type CreditCardInstrument,
} from "../../src/features/financial/lib/card-invoices";

const card: CreditCardInstrument = {
  accountId: "inter",
  accountName: "Banco Inter",
  methodId: "card-1234",
  methodLabel: "Cartão Inter 1234",
  closingDay: 5,
  dueDay: 12,
};

test("atribui compras antes e depois do fechamento às faturas corretas", () => {
  const beforeClosing = resolveCardStatementCycle(new Date(2026, 7, 3, 12), card);
  const afterClosing = resolveCardStatementCycle(new Date(2026, 7, 6, 12), card);

  assert.equal(beforeClosing.monthKey, "2026-08");
  assert.equal(beforeClosing.dueDate.getDate(), 12);
  assert.equal(afterClosing.monthKey, "2026-09");
});

test("trata corretamente cartões cujo vencimento ocorre no mês seguinte ao fechamento", () => {
  const cycle = resolveCardStatementCycle(new Date(2026, 7, 10, 12), {
    ...card,
    closingDay: 28,
    dueDay: 5,
  });

  assert.equal(cycle.monthKey, "2026-09");
  assert.equal(cycle.closingDate.getMonth(), 7);
  assert.equal(cycle.dueDate.getMonth(), 8);
});

test("reconstrói um ciclo vazio a partir do mês de vencimento", () => {
  const cycle = resolveCardStatementCycleFromMonth("2026-09", {
    ...card,
    closingDay: 28,
    dueDay: 5,
  });

  assert.equal(cycle.dueDate.getMonth(), 8);
  assert.equal(cycle.closingDate.getMonth(), 7);
  assert.equal(cycle.key, "inter:card-1234:2026-09");
});

test("agrupa despesas recorrentes e parcelas sem transformar a fatura em nova despesa", () => {
  const groups = buildCardStatementGroups([
    {
      id: "google-agosto",
      description: "Google Workspace",
      totalValue: 120,
      dueDate: new Date(2026, 7, 3, 12),
      paymentMethod: "recurring",
      recurrenceGroupId: "google",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
      cardReconciliationStatus: "reconciled",
    },
    {
      id: "equipamento-2",
      description: "Equipamento parcelado",
      totalValue: 6_000,
      dueDate: new Date(2026, 7, 4, 12),
      paymentMethod: "installments",
      installments: [
        { number: 1, dueDate: new Date(2026, 7, 4, 12), value: 500 },
        { number: 2, dueDate: new Date(2026, 8, 4, 12), value: 500 },
      ],
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
    },
  ], [card]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.projectedTotal, 620);
  assert.equal(groups[0]?.reconciledTotal, 120);
  assert.equal(groups[0]?.recurringCount, 1);
  assert.equal(groups[0]?.lines[1]?.installmentNumber, 1);
  assert.equal(groups[1]?.projectedTotal, 500);
});

test("exibe a previsão do cartão e remove a previsão substituída pelo gasto real", () => {
  const groups = buildCardStatementGroups([
    {
      id: "gpt-previsao",
      description: "GPT/Codex | OpenAI",
      supplier: "OpenAI",
      totalValue: 100,
      dueDate: new Date(2026, 7, 3, 12),
      status: "provisioned",
      provisionType: "forecast",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
    },
  ], [card]);

  assert.equal(groups[0]?.provisionCount, 1);
  assert.equal(groups[0]?.provisionedTotal, 100);
  assert.equal(groups[0]?.projectedTotal, 100);

  const reconciledGroups = buildCardStatementGroups([
    {
      id: "gpt-previsao",
      description: "GPT/Codex | OpenAI",
      totalValue: 100,
      dueDate: new Date(2026, 7, 3, 12),
      status: "reconciled",
      provisionType: "forecast",
      replacedByExpenseId: "gpt-real",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
    },
    {
      id: "gpt-real",
      description: "GPT/Codex | OpenAI",
      totalValue: 112,
      dueDate: new Date(2026, 7, 3, 12),
      status: "pending",
      provisionType: "actual",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
    },
  ], [card]);

  assert.equal(reconciledGroups[0]?.lines.length, 1);
  assert.equal(reconciledGroups[0]?.projectedTotal, 112);
  assert.equal(reconciledGroups[0]?.provisionedTotal, 0);
});

test("congela a distribuição contábil das despesas vinculadas ao pagamento único", () => {
  const allocations = buildCardStatementAllocations([{
    lineId: "internet:2026-08",
    expense: {
      id: "internet",
      description: "Internet - Administrativo | TVN",
      supplier: "TVN",
      competenceDate: new Date(2026, 7, 1, 12),
      accountPlanId: "internet-account",
      accountPlanName: "Internet",
      resultCenterId: "administrativo",
      resultCenterName: "Centro administrativo",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1234",
    },
    chargeDate: new Date(2026, 7, 3, 12),
    value: 102.93,
    reconciled: true,
  }]);

  assert.deepEqual(allocations[0], {
    lineId: "internet:2026-08",
    expenseId: "internet",
    installmentNumber: null,
    description: "Internet - Administrativo | TVN",
    supplier: "TVN",
    amount: 102.93,
    competenceDate: "2026-08-01",
    accountPlanId: "internet-account",
    accountPlanName: "Internet",
    resultCenterId: "administrativo",
    resultCenterName: "Centro administrativo",
    accountAllocations: [],
    apportionments: [],
  });
});

test("sugere somente saídas bancárias compatíveis com o total e o vencimento", () => {
  const candidates = findCardStatementPaymentCandidates(620, new Date(2026, 7, 12, 12), [
    { id: "exact", direction: "out", amount: 620, date: new Date(2026, 7, 12, 12) },
    { id: "near", direction: "out", amount: 630, date: new Date(2026, 7, 15, 12) },
    { id: "wrong", direction: "out", amount: 300, date: new Date(2026, 7, 12, 12) },
    { id: "income", direction: "in", amount: 620, date: new Date(2026, 7, 12, 12) },
  ]);

  assert.deepEqual(candidates.map((candidate) => [candidate.transaction.id, candidate.confidence]), [
    ["exact", "high"],
    ["near", "medium"],
  ]);
});
