import assert from "node:assert/strict";
import test from "node:test";

import {
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
  assert.deepEqual(entries[0].statement.auditCounts, { pending: 1, audited: 0, reconciled: 1 });
  assert.equal(entries[0].statement.statementId, cardStatementDocumentId(statementKey));
});

test("mantém despesas que não pertencem a uma fatura como linhas independentes", () => {
  const ordinaryExpense = { id: "rent", totalValue: 3000, status: "pending" };
  const entries = groupExpensesByCardStatement([ordinaryExpense]);
  assert.deepEqual(entries, [{ kind: "expense", expense: ordinaryExpense }]);
});
