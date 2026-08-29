import assert from "node:assert/strict";
import test from "node:test";

import {
  cashDepositPeriodPolicyDocumentId,
  planCashDepositPeriodPolicyChange,
} from "../../src/features/financial/cash-closures/deposit-policy-command";

const command = {
  workspaceId: "coala",
  year: 2026,
  month: 8,
  policy: "dre_only" as const,
  reason: "Competência histórica usada somente na DRE",
  actorId: "finance-user",
  actorName: "Financeiro",
};

test("planeja política de competência com identificador determinístico", () => {
  const plan = planCashDepositPeriodPolicyChange({
    command,
    existing: null,
    now: "2026-08-29T12:00:00.000Z",
  });
  assert.equal(cashDepositPeriodPolicyDocumentId("coala", 2026, 8), "coala_2026_08");
  assert.equal(plan.action, "create");
  assert.equal(plan.next.policy, "dre_only");
  assert.equal(plan.next.createdBy, "finance-user");
});

test("segunda execução idêntica não produz escrita", () => {
  const first = planCashDepositPeriodPolicyChange({
    command,
    existing: null,
    now: "2026-08-29T12:00:00.000Z",
  });
  const second = planCashDepositPeriodPolicyChange({
    command,
    existing: first.next,
    now: "2026-08-29T13:00:00.000Z",
  });
  assert.equal(second.action, "unchanged");
  assert.deepEqual(second.next, first.next);
});

test("mudança preserva autoria original e atualiza auditor responsável", () => {
  const first = planCashDepositPeriodPolicyChange({
    command,
    existing: null,
    now: "2026-08-29T12:00:00.000Z",
  });
  const changed = planCashDepositPeriodPolicyChange({
    command: { ...command, policy: "standard", reason: "Competência liberada para depósito", actorId: "admin-user" },
    existing: first.next,
    now: "2026-08-30T12:00:00.000Z",
  });
  assert.equal(changed.action, "update");
  assert.equal(changed.next.createdBy, "finance-user");
  assert.equal(changed.next.updatedBy, "admin-user");
});
