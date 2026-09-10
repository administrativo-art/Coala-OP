import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImportAuditLinkPresentation,
  getImportAuditSourceDescription,
  type ImportAuditLinkedExpense,
} from "../../src/features/financial/lib/import-audit-link-presentation";

const expenses = new Map<string, ImportAuditLinkedExpense>([
  [
    "expense-1",
    {
      id: "expense-1",
      description: "Salário - 08/2026 | Maria José de Sousa Pereira",
      accountPlanName: "Salários",
      isApportioned: true,
    },
  ],
  ["expense-2", { id: "expense-2", description: "Encargos trabalhistas" }],
]);

function presentation(
  overrides: Partial<
    Parameters<typeof buildImportAuditLinkPresentation>[0]
  > = {},
) {
  return buildImportAuditLinkPresentation({
    amount: -2_270.62,
    movementKind: "standard",
    isCardStatementSettlement: false,
    expenseMode: "existing",
    expensesById: expenses,
    ...overrides,
  });
}

test("preserva a descrição bancária como título mesmo quando há uma descrição financeira", () => {
  assert.equal(
    getImportAuditSourceDescription({
      rawDescription: "  Pix enviado — Maria Jose  De Sousa Pereira ",
      financialDescription: "Salário - 08/2026 | Maria José de Sousa Pereira",
    }),
    "Pix enviado — Maria Jose De Sousa Pereira",
  );
});

test("mostra a despesa vinculada e sua classificação contábil", () => {
  assert.deepEqual(presentation({ linkedExpenseId: "expense-1" }), {
    label: "Vinculada a: Salário - 08/2026 | Maria José de Sousa Pereira",
    meta: "Salários · Rateado",
    expenseId: "expense-1",
    action: "expense",
    tone: "linked",
  });
});

test("usa os vínculos gravados na efetivação e resume múltiplas despesas", () => {
  assert.deepEqual(
    presentation({
      linkedExpenseId: "expense-1",
      effectuationExpenseIds: ["expense-1", "expense-2"],
    }),
    {
      label: "Vinculada a 2 despesas",
      meta: "Ver vínculos",
      expenseId: null,
      action: "details",
      tone: "linked",
    },
  );
});

test("distingue rateios de outros conjuntos de despesas", () => {
  assert.equal(
    presentation({
      expenseMode: "split",
      effectuationExpenseIds: ["expense-1", "expense-2"],
    }).meta,
    "Ver rateio",
  );
});

test("mostra o progresso quando a despesa vinculada foi paga parcialmente", () => {
  const partialExpenses = new Map<string, ImportAuditLinkedExpense>([
    [
      "expense-partial",
      {
        id: "expense-partial",
        description: "Contrato de manutenção",
        status: "partially_paid",
        settlementSummary: {
          settlementAmountCents: 227_062,
          balanceAmountCents: 77_062,
        },
      },
    ],
  ]);

  assert.equal(
    presentation({
      linkedExpenseId: "expense-partial",
      expensesById: partialExpenses,
    }).meta,
    "R$ 1.500,00 de R$ 2.270,62 pagos",
  );
});

test("oferece vinculação quando uma saída ainda não possui despesa", () => {
  assert.deepEqual(presentation(), {
    label: "Sem despesa vinculada",
    meta: "Vincular",
    expenseId: null,
    action: "details",
    tone: "pending",
  });
});

test("não exige vínculo de despesa para receitas", () => {
  assert.deepEqual(presentation({ amount: 124.08 }), {
    label: "Receita reconhecida no extrato",
    meta: null,
    expenseId: null,
    action: null,
    tone: "neutral",
  });
});
