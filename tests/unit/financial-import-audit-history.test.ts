import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImportAuditSnapshot,
  diffImportAuditSnapshots,
} from "../../src/features/financial/lib/import-audit-history";

function item(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-17",
    rawDescription: "Pagamento efetuado — Shopping",
    financialDraft: {
      date: "2026-08-17",
      description: "Pagamento de aluguel",
      accountName: "Banco Inter",
      paymentMethodLabel: "Pagamento de boleto",
    },
    expenseDraft: {
      mode: "new",
      description: "Aluguel | Quiosque",
      supplier: "Shopping",
      accountPlanName: "Aluguéis",
      resultCenterName: "Quiosque João Paulo",
      competenceDate: "2026-08-01",
      dueDate: "2026-08-10",
      apportionments: [],
      splitExpenses: [],
    },
    ...overrides,
  };
}

test("a primeira confirmação não lista todos os campos como alterações", () => {
  const snapshot = buildImportAuditSnapshot(item());
  assert.deepEqual(diffImportAuditSnapshots(null, snapshot), []);
});

test("uma nova confirmação registra somente as diferenças relevantes", () => {
  const previous = buildImportAuditSnapshot(item());
  const next = buildImportAuditSnapshot(item({
    financialDraft: {
      date: "2026-08-17",
      description: "Aluguel de agosto",
      accountName: "Banco Inter",
      paymentMethodLabel: "Pagamento de boleto",
    },
    expenseDraft: {
      mode: "new",
      description: "Aluguel | Quiosque",
      supplier: "Shopping",
      accountPlanName: "Aluguéis",
      resultCenterName: "Quiosque Tirirical",
      competenceDate: "2026-08-01",
      dueDate: "2026-08-10",
      apportionments: [],
      splitExpenses: [],
    },
  }));

  assert.deepEqual(
    diffImportAuditSnapshots(previous, next).map((change) => change.label),
    ["Unidade"]
  );
});

test("rateios são resumidos em texto legível no histórico", () => {
  const snapshot = buildImportAuditSnapshot(item({
    expenseDraft: {
      mode: "new",
      description: "Energia",
      apportionments: [
        { resultCenterName: "Matriz", percentage: 60 },
        { resultCenterName: "Quiosque", percentage: 40 },
      ],
      splitExpenses: [],
    },
  }));

  assert.equal(snapshot.values["expense.apportionments"], "Matriz (60%); Quiosque (40%)");
});

test("registra alterações no vencimento original", () => {
  const previous = buildImportAuditSnapshot(item());
  const next = buildImportAuditSnapshot(item({
    expenseDraft: {
      mode: "new",
      description: "Aluguel | Quiosque",
      supplier: "Shopping",
      accountPlanName: "Aluguéis",
      resultCenterName: "Quiosque João Paulo",
      competenceDate: "2026-08-01",
      dueDate: "2026-08-15",
      apportionments: [],
      splitExpenses: [],
    },
  }));

  assert.deepEqual(
    diffImportAuditSnapshots(previous, next).map((change) => change.label),
    ["Vencimento original"],
  );
});

test("resume apropriações contábeis no histórico", () => {
  const snapshot = buildImportAuditSnapshot(item({
    expenseDraft: {
      mode: "new",
      description: "DAS competência agosto",
      supplier: "Receita Federal",
      accountPlanName: "DAS",
      accountAllocations: [
        { accountPlanName: "Simples Nacional", amount: 800 },
        { accountPlanName: "ICMS", amount: 200 },
      ],
      resultCenterName: "Matriz",
      competenceDate: "2026-08-01",
      dueDate: "2026-08-20",
      apportionments: [],
      splitExpenses: [],
    },
  }));

  assert.equal(
    snapshot.values["expense.accountAllocations"],
    "Simples Nacional (R$ 800); ICMS (R$ 200)",
  );
});
