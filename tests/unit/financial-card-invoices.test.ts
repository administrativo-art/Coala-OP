import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCardStatementAllocations,
  buildCardStatementGroups,
  buildCardStatementLinesFromAllocations,
  canRegisterCardStatementAsHistorical,
  cardStatementAllocationIntegrity,
  cardStatementLineAuditIssues,
  cardStatementLineAuditStatus,
  findCardStatementPaymentCandidates,
  resolveCardStatementCycle,
  resolveCardStatementCycleFromMonth,
  resolveCardStatementDatesFromDueDate,
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

test("mantém a competência explícita da fatura separada do mês de vencimento", () => {
  const dates = resolveCardStatementDatesFromDueDate(new Date(2026, 8, 12, 12), card);
  const groups = buildCardStatementGroups([{
    id: "compra-agosto",
    description: "Compra de agosto com vencimento em setembro",
    totalValue: 100,
    competenceDate: new Date(2026, 7, 18, 12),
    cardChargeDate: new Date(2026, 7, 18, 12),
    dueDate: new Date(2026, 8, 12, 12),
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1234",
    cardStatementKey: "inter:card-1234:2026-08",
    cardStatementMonthKey: "2026-08",
  }], [card]);

  assert.equal(groups[0]?.monthKey, "2026-08");
  assert.equal(groups[0]?.lines[0]?.chargeDate.getMonth(), 7);
  assert.equal(dates.closingDate.getMonth(), 8);
  assert.equal(dates.closingDate.getDate(), 5);
  assert.equal(dates.dueDate.getMonth(), 8);
  assert.equal(dates.dueDate.getDate(), 12);
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

test("usa a fatura explícita da parcela e não reaplica o fechamento sobre seu vencimento", () => {
  const groups = buildCardStatementGroups([{
    id: "banco-ergonomico",
    description: "Banco semi-sentado ergonômico - 07/2026 | Mercado Livre",
    supplier: "Mercado Livre",
    totalValue: 439,
    cardChargeDate: new Date(2026, 6, 30, 12),
    paymentMethod: "installments",
    installments: [
      { number: 1, dueDate: new Date(2026, 7, 12, 12), value: 54.88 },
      {
        number: 2,
        dueDate: new Date(2026, 8, 12, 12),
        value: 54.87,
        cardStatementKey: "inter:card-1234:2026-08",
        cardStatementMonthKey: "2026-08",
      },
      { number: 3, dueDate: new Date(2026, 9, 12, 12), value: 54.88 },
    ],
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1234",
  }], [card]);

  const august = groups.find((group) => group.monthKey === "2026-08");
  const october = groups.find((group) => group.monthKey === "2026-10");
  assert.deepEqual(august?.lines.map((line) => line.installmentNumber), [1, 2]);
  assert.deepEqual(october?.lines.map((line) => line.installmentNumber), [3]);
  assert.equal(groups.some((group) => group.monthKey === "2026-11"), false);
});

test("mantém as oito parcelas em oito faturas quando cada parcela tem competência congelada", () => {
  const installments = Array.from({ length: 8 }, (_, index) => {
    const month = new Date(Date.UTC(2026, 6 + index, 1));
    const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      number: index + 1,
      dueDate: new Date(Date.UTC(2026, 7 + index, 12, 15)),
      value: index % 2 === 0 ? 54.88 : 54.87,
      cardStatementKey: `account:card:${monthKey}`,
      cardStatementMonthKey: monthKey,
      cardStatementRevisionStatus: index === 1 ? "active" : "projected",
    };
  });
  const groups = buildCardStatementGroups([{
    id: "chair",
    description: "Banco semi-sentado ergonômico - 07/2026 | Mercado Livre",
    supplier: "Mercado Livre",
    totalValue: 439,
    cardChargeDate: new Date("2026-07-30T12:00:00-03:00"),
    competenceDate: new Date("2026-07-01T12:00:00-03:00"),
    paymentMethod: "installments",
    installments,
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "account",
    plannedPaymentMethodId: "card",
  }], [{
    accountId: "account",
    accountName: "Inter",
    methodId: "card",
    methodLabel: "Cartão",
    closingDay: 5,
    dueDay: 12,
  }]);

  assert.deepEqual(groups.map((group) => group.monthKey), [
    "2026-07", "2026-08", "2026-09", "2026-10",
    "2026-11", "2026-12", "2027-01", "2027-02",
  ]);
  assert.deepEqual(groups.map((group) => group.lines[0]?.installmentNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("reconstrói a fatura oficial pelas alocações persistidas", () => {
  const expenses = [{
    id: "compra",
    description: "Compra parcelada",
    supplier: "Fornecedor",
    cardChargeDate: new Date(2026, 6, 30, 12),
    paymentMethod: "installments",
    installments: [
      { number: 1, dueDate: new Date(2026, 7, 12, 12), value: 50 },
      { number: 2, dueDate: new Date(2026, 8, 12, 12), value: 54.87, cardReconciliationStatus: "reconciled" },
    ],
  }];
  const lines = buildCardStatementLinesFromAllocations([{
    lineId: "compra:installment:2",
    expenseId: "compra",
    installmentNumber: 2,
    description: "Compra parcelada",
    supplier: "Fornecedor",
    amount: 54.87,
    competenceDate: "2026-08-01",
    accountPlanId: "equipamentos",
    accountPlanName: "Equipamentos",
    resultCenterId: "administrativo",
    resultCenterName: "Administrativo",
    accountAllocations: [],
    apportionments: [],
  }], expenses);

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.lineId, "compra:installment:2");
  assert.equal(lines[0]?.installmentNumber, 2);
  assert.equal(lines[0]?.value, 54.87);
  assert.equal(lines[0]?.reconciled, true);
});

test("bloqueia alocações duplicadas ou com soma diferente do total oficial", () => {
  const valid = cardStatementAllocationIntegrity([
    { lineId: "expense-1", amount: 100, importFingerprint: "fp-1" },
    { lineId: "expense-2", amount: 54.87, importFingerprint: "fp-2" },
  ], 154.87);
  assert.equal(valid.valid, true);

  const duplicate = cardStatementAllocationIntegrity([
    { lineId: "expense-1", amount: 100, importFingerprint: "fp-1" },
    { lineId: "expense-1", amount: 54.87, importFingerprint: "fp-1" },
  ], 200);
  assert.equal(duplicate.valid, false);
  assert.deepEqual(duplicate.duplicateLineIds, ["expense-1"]);
  assert.deepEqual(duplicate.duplicateFingerprints, ["fp-1"]);
  assert.equal(duplicate.difference, 45.13);
});

test("desconta créditos e estornos ao conferir o total oficial", () => {
  const result = cardStatementAllocationIntegrity([
    { lineId: "charges", amount: 6531.35, importFingerprint: "fp-charges" },
  ], 6137.84, 393.51);

  assert.equal(result.valid, true);
  assert.equal(result.grossAllocatedTotal, 6531.35);
  assert.equal(result.creditTotal, 393.51);
  assert.equal(result.allocatedTotal, 6137.84);
  assert.equal(result.difference, 0);
});

test("permite registro histórico somente antes do início da DRE", () => {
  assert.equal(canRegisterCardStatementAsHistorical("2026-07", "2026-08"), true);
  assert.equal(canRegisterCardStatementAsHistorical("2026-08", "2026-08"), false);
  assert.equal(canRegisterCardStatementAsHistorical("2026-09", "2026-08"), false);
  assert.equal(canRegisterCardStatementAsHistorical("competencia-invalida", "2026-08"), false);
});

test("identifica linha histórica anterior à DRE sem tratá-la como auditada", () => {
  const line = {
    lineId: "historical-line",
    expense: {
      id: "historical-expense",
      description: "Compra preservada da fatura anterior",
      supplier: "Fornecedor",
      competenceDate: new Date("2026-07-01T12:00:00-03:00"),
      cardStatementAuditDisposition: "waived_before_dre_start",
    },
    chargeDate: new Date("2026-07-18T12:00:00-03:00"),
    value: 100,
    reconciled: false,
    installmentNumber: 3,
    installmentTotal: 12,
  };

  assert.deepEqual(cardStatementLineAuditIssues(line), []);
  assert.equal(cardStatementLineAuditStatus(line), "historical");
  assert.equal(cardStatementLineAuditStatus({ ...line, reconciled: true }), "reconciled");
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

test("oculta da versão ativa itens removidos sem apagar a despesa histórica", () => {
  const groups = buildCardStatementGroups([{
    id: "historical-charge",
    description: "Cobrança removida na retificação",
    totalValue: 90,
    dueDate: new Date(2026, 7, 3, 12),
    status: "pending",
    cardStatementRevisionStatus: "removed",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1234",
  }, {
    id: "installment-charge",
    description: "Compra parcelada",
    totalValue: 200,
    paymentMethod: "installments",
    installments: [
      { number: 1, dueDate: new Date(2026, 7, 3, 12), value: 100, cardStatementRevisionStatus: "removed" },
      { number: 2, dueDate: new Date(2026, 8, 3, 12), value: 100 },
    ],
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1234",
  }], [card]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.monthKey, "2026-09");
  assert.equal(groups[0]?.lines.length, 1);
  assert.equal(groups[0]?.lines[0]?.installmentNumber, 2);
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
