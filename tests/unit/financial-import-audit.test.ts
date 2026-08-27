import assert from "node:assert/strict";
import test from "node:test";

import { invalidateAuditAfterEdit } from "../../src/features/financial/lib/import-audit";

test("volta uma auditoria confirmada para pendente quando os dados mudam", () => {
  const previous = { status: "audited" as const, description: "Aluguel", accountId: "conta-1" };
  const next = { ...previous, description: "Honorários" };

  assert.deepEqual(invalidateAuditAfterEdit(previous, next), {
    ...next,
    status: "pending",
  });
});

test("mantém a confirmação quando a edição não altera o valor", () => {
  const previous = { status: "audited" as const, description: "Aluguel" };

  assert.deepEqual(invalidateAuditAfterEdit(previous, { ...previous }), previous);
});

test("preserva mudanças explícitas de status e itens já efetivados", () => {
  const audited = { status: "audited" as const, description: "Aluguel" };
  const ignored = { ...audited, status: "ignored" as const };
  const completed = { status: "completed" as const, description: "Aluguel" };
  const completedEdit = { ...completed, description: "Honorários" };

  assert.deepEqual(invalidateAuditAfterEdit(audited, ignored), ignored);
  assert.deepEqual(invalidateAuditAfterEdit(completed, completedEdit), completedEdit);
});
