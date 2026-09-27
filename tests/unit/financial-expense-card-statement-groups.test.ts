import assert from "node:assert/strict";
import test from "node:test";

import {
  cardExpenseStatementOccurrences,
  cardStatementDocumentId,
  groupExpensesByCardStatement,
} from "../../src/features/financial/lib/expense-card-statement-groups";

const statementKey = "inter:card-1127:2026-08";

test("agrupa compras do cartão em uma única fatura sem somar uma nova despesa", () => {
  const entries = groupExpensesByCardStatement([
    {
      id: "mercado-livre",
      description: "MERCADOLIVRE MERCADOL GUARULHOS BRA",
      supplier: "MERCADOLIVRE",
      totalValue: 54.87,
      status: "pending",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1127",
      plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
      cardStatementKey: statementKey,
      cardStatementMonthKey: "2026-08",
      cardReconciliationStatus: "pending",
      competenceDate: new Date("2026-08-01T12:00:00"),
      dueDate: new Date("2026-09-12T12:00:00"),
    },
    {
      id: "tartu",
      description: "TARTU SERVICE SAO PAULO BRA",
      supplier: "TARTU SERVICE",
      totalValue: 124.75,
      status: "pending",
      plannedPaymentMethodType: "credit_card",
      plannedBankAccountId: "inter",
      plannedPaymentMethodId: "card-1127",
      plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
      cardStatementKey: statementKey,
      cardStatementMonthKey: "2026-08",
      cardReconciliationStatus: "reconciled",
      competenceDate: new Date("2026-08-01T12:00:00"),
      dueDate: new Date("2026-09-12T12:00:00"),
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "card_statement");
  if (entries[0]?.kind !== "card_statement") return;
  assert.equal(entries[0].statement.title, "Fatura Inter 1127 — 08/2026");
  assert.equal(entries[0].statement.totalValue, 179.62);
  assert.equal(entries[0].statement.expenses.length, 2);
  assert.deepEqual(entries[0].statement.auditCounts, { pending: 1, audited: 0, historical: 0, reconciled: 1 });
  assert.equal(entries[0].statement.statementId, cardStatementDocumentId(statementKey));
});

test("mantém despesas que não pertencem a uma fatura como linhas independentes", () => {
  const ordinaryExpense = { id: "rent", totalValue: 3000, status: "pending" };
  const entries = groupExpensesByCardStatement([ordinaryExpense]);
  assert.deepEqual(entries, [{ kind: "expense", expense: ordinaryExpense }]);
});

test("separa o histórico anterior à DRE da fila de auditoria", () => {
  const entries = groupExpensesByCardStatement([{
    id: "historical-charge",
    description: "Compra histórica do cartão",
    supplier: "Fornecedor",
    totalValue: 100,
    status: "pending",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
    cardStatementKey: "inter:card-1127:2026-07",
    cardStatementMonthKey: "2026-07",
    cardStatementAuditDisposition: "waived_before_dre_start",
    competenceDate: new Date("2026-07-01T12:00:00"),
    dueDate: new Date("2026-08-12T12:00:00"),
  }]);

  assert.equal(entries[0]?.kind, "card_statement");
  if (entries[0]?.kind !== "card_statement") return;
  assert.deepEqual(entries[0].statement.auditCounts, { pending: 0, audited: 0, historical: 1, reconciled: 0 });
});

test("usa as alocações oficiais sem somar cancelamentos, provisões substituídas ou o valor integral da compra parcelada", () => {
  const installmentExpense = {
    id: "frigobar",
    description: "Frigobar parcelado",
    supplier: "Amazon",
    totalValue: 1_200,
    status: "pending",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
    cardStatementKey: statementKey,
    cardStatementMonthKey: "2026-08",
    competenceDate: new Date("2026-08-01T12:00:00"),
    dueDate: new Date("2026-09-12T12:00:00"),
    paymentMethod: "installments",
    installments: [{
      number: 4,
      value: 100,
      cardStatementKey: statementKey,
      cardStatementMonthKey: "2026-08",
    }],
  };
  const currentExpense = {
    id: "vivo",
    description: "Conta de celular Vivo",
    supplier: "Vivo",
    totalValue: 50,
    status: "pending",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
    cardStatementKey: statementKey,
    cardStatementMonthKey: "2026-08",
    competenceDate: new Date("2026-08-01T12:00:00"),
    dueDate: new Date("2026-09-12T12:00:00"),
  };
  const cancelledImport = {
    ...currentExpense,
    id: "raw-vivo",
    description: "VIVO RAW",
    status: "cancelled",
  };
  const replacedForecast = {
    ...currentExpense,
    id: "forecast-vivo",
    description: "Previsão Vivo",
    status: "reconciled",
    provisionType: "forecast",
    replacedByExpenseId: "vivo",
  };
  const allocationDefaults = {
    competenceDate: "2026-08-01",
    accountPlanId: "telefonia",
    accountPlanName: "Telefonia",
    resultCenterId: "matriz",
    resultCenterName: "Matriz",
    accountAllocations: [],
    apportionments: [],
  };

  const entries = groupExpensesByCardStatement([currentExpense, installmentExpense], {
    allExpenses: [currentExpense, installmentExpense, cancelledImport, replacedForecast],
    statements: [{
      id: cardStatementDocumentId(statementKey),
      key: statementKey,
      monthKey: "2026-08",
      accountId: "inter",
      paymentMethodId: "card-1127",
      paymentMethodLabel: "Cartão Crédito Inter - 1127",
      officialTotal: 140,
      creditTotal: 10,
      status: "open",
      dueDate: new Date("2026-09-12T12:00:00"),
      allocations: [
        {
          ...allocationDefaults,
          lineId: "vivo",
          expenseId: "vivo",
          installmentNumber: null,
          description: "Conta de celular Vivo",
          supplier: "Vivo",
          amount: 50,
        },
        {
          ...allocationDefaults,
          lineId: "frigobar:installment:4",
          expenseId: "frigobar",
          installmentNumber: 4,
          description: "Frigobar parcelado",
          supplier: "Amazon",
          amount: 100,
        },
      ],
    }],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "card_statement");
  if (entries[0]?.kind !== "card_statement") return;
  assert.equal(entries[0].statement.official, true);
  assert.equal(entries[0].statement.totalValue, 140);
  assert.equal(entries[0].statement.creditTotal, 10);
  assert.equal(entries[0].statement.lineCount, 2);
  assert.deepEqual(entries[0].statement.lines.map((line) => line.amount), [50, 100]);
  assert.deepEqual(entries[0].statement.unmatchedExpenses.map((expense) => expense.id), ["raw-vivo", "forecast-vivo"]);
});

test("projeta uma compra parcelada em uma fatura por parcela", () => {
  const octoberKey = "inter:card-1127:2026-10";
  const novemberKey = "inter:card-1127:2026-11";
  const entries = groupExpensesByCardStatement([{
    id: "freezer",
    description: "Freezer parcelado no cartão",
    supplier: "Mercado Livre",
    totalValue: 540.82,
    status: "pending",
    paymentMethod: "installments",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    plannedPaymentMethodLabel: "Cartão Crédito Inter - 1127",
    cardStatementKey: octoberKey,
    cardStatementMonthKey: "2026-10",
    competenceDate: new Date("2026-09-15T12:00:00-03:00"),
    installments: [
      { number: 1, value: 270.41, dueDate: new Date("2026-10-12T12:00:00-03:00"), cardStatementKey: octoberKey, cardStatementMonthKey: "2026-10" },
      { number: 2, value: 270.41, dueDate: new Date("2026-11-12T12:00:00-03:00"), cardStatementKey: novemberKey, cardStatementMonthKey: "2026-11" },
    ],
  }]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.kind === "card_statement"
    ? [
        entry.statement.monthKey,
        entry.statement.totalValue,
        entry.statement.lines[0]?.installmentNumber,
        entry.statement.dueDate?.toISOString(),
      ]
    : null), [
    ["2026-10", 270.41, 1, "2026-10-12T15:00:00.000Z"],
    ["2026-11", 270.41, 2, "2026-11-12T15:00:00.000Z"],
  ]);
});

test("filtra a compra parcelada pela competência e vencimento da própria fatura", () => {
  const expense = {
    id: "freezer-filtered",
    totalValue: 540.82,
    status: "pending",
    paymentMethod: "installments",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    cardStatementKey: "inter:card-1127:2026-10",
    cardStatementMonthKey: "2026-10",
    dueDate: new Date("2026-10-12T12:00:00-03:00"),
    competenceDate: new Date("2026-09-15T12:00:00-03:00"),
    installments: [
      { number: 1, value: 270.41, dueDate: new Date("2026-10-12T12:00:00-03:00"), cardStatementKey: "inter:card-1127:2026-10", cardStatementMonthKey: "2026-10" },
      { number: 2, value: 270.41, dueDate: new Date("2026-11-12T12:00:00-03:00"), cardStatementKey: "inter:card-1127:2026-11", cardStatementMonthKey: "2026-11" },
    ],
  };
  const entries = groupExpensesByCardStatement([expense], {
    statementMonthKey: "2026-11",
    statementDateFrom: new Date("2026-11-01T00:00:00-03:00"),
    statementDateTo: new Date("2026-11-30T23:59:59-03:00"),
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "card_statement");
  if (entries[0].kind !== "card_statement") return;
  assert.equal(entries[0].statement.monthKey, "2026-11");
  assert.equal(entries[0].statement.totalValue, 270.41);
  assert.equal(entries[0].statement.lines[0]?.installmentNumber, 2);

  const incompatiblePeriod = groupExpensesByCardStatement([expense], {
    statementMonthKey: "2026-11",
    statementDateFrom: new Date("2026-10-01T00:00:00-03:00"),
    statementDateTo: new Date("2026-10-31T23:59:59-03:00"),
  });
  assert.deepEqual(incompatiblePeriod, []);
});

test("usa o vencimento oficial da fatura nos filtros da ocorrência", () => {
  const expense = {
    id: "official-due-date",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    cardStatementKey: "inter:card-1127:2026-10",
    cardStatementMonthKey: "2026-10",
    dueDate: new Date("2026-10-12T12:00:00-03:00"),
  };
  const occurrences = cardExpenseStatementOccurrences(expense, [{
    id: "inter__card-1127__2026-10",
    key: "inter:card-1127:2026-10",
    monthKey: "2026-10",
    dueDate: new Date("2026-10-15T12:00:00-03:00"),
  }]);

  assert.equal(occurrences[0]?.dueDate?.toISOString(), "2026-10-15T15:00:00.000Z");
});

test("não ressuscita pelo valor integral uma parcela removida da revisão", () => {
  const entries = groupExpensesByCardStatement([{
    id: "revised-installments",
    totalValue: 540.82,
    status: "pending",
    paymentMethod: "installments",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    cardStatementKey: "inter:card-1127:2026-10",
    cardStatementMonthKey: "2026-10",
    installments: [
      {
        number: 1,
        value: 270.41,
        dueDate: new Date("2026-10-12T12:00:00-03:00"),
        cardStatementKey: "inter:card-1127:2026-10",
        cardStatementMonthKey: "2026-10",
        cardStatementRevisionStatus: "removed",
      },
      {
        number: 2,
        value: 270.41,
        dueDate: new Date("2026-11-12T12:00:00-03:00"),
        cardStatementKey: "inter:card-1127:2026-11",
        cardStatementMonthKey: "2026-11",
        cardStatementRevisionStatus: "active",
      },
    ],
  }]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "card_statement");
  if (entries[0].kind !== "card_statement") return;
  assert.equal(entries[0].statement.monthKey, "2026-11");
  assert.equal(entries[0].statement.totalValue, 270.41);
  assert.equal(entries[0].statement.lines[0]?.installmentNumber, 2);

  const allRemoved = groupExpensesByCardStatement([{
    id: "fully-removed-installments",
    totalValue: 540.82,
    status: "pending",
    paymentMethod: "installments",
    plannedPaymentMethodType: "credit_card",
    plannedBankAccountId: "inter",
    plannedPaymentMethodId: "card-1127",
    installments: [{
      number: 1,
      value: 540.82,
      cardStatementKey: "inter:card-1127:2026-10",
      cardStatementMonthKey: "2026-10",
      cardStatementRevisionStatus: "removed",
    }],
  }]);
  assert.deepEqual(allRemoved, []);
});
