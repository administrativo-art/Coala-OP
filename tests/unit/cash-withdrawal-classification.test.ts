import assert from "node:assert/strict";
import test from "node:test";
import { parsePdvCashMovements } from "../../src/features/financial/cash-closures/pdv-cash-movements";
import {
  assertEligibleWithdrawalExpense, assertWithdrawalSourceIntegrity, sourceExpenseGuard,
  withdrawalClassificationSchema, withdrawalSources,
} from "../../src/features/financial/cash-closures/withdrawal-classification";
import { assertExpenseAllowsNewPayment, sourceSettlementSummary } from "../../src/features/financial/lib/source-settlement";
import type { CashClosure, CashClosureLine } from "../../src/features/financial/cash-closures/types";

const movement = { id: "m-1", identitySource: "provider" as const, kind: "withdrawal" as const, amountCents: 1000,
  date: "2026-09-01", occurredAt: "2026-09-01T12:00:00-03:00", operatorId: "op", terminalId: "t",
  paymentMethodId: "cash", paymentMethodName: "DINHEIRO", isCash: true, cancelled: false };
const closure = { id: "unit_2026-09-01", workspaceId: "coala", kioskId: "unit", pdvFilialId: "pdv", date: movement.date, source: {} } as CashClosure;
const line = { id: "line", operatorId: "op", channel: "cash", metadata: { withdrawalCents: 1000, cashMovements: [movement] } } as CashClosureLine;
const source = withdrawalSources(closure, [line]).sources[0];

test("identidade provém do PDV; índice sintético nunca é considerado comprovado", () => {
  const parsed = parsePdvCashMovements({ withdrawals: [{ codigo: 9, valor: 10, data: movement.date, nomeFormaPagamento: "DINHEIRO", codUsuario: "op" },
    { valor: 10, data: movement.date, nomeFormaPagamento: "DINHEIRO", codUsuario: "op" }], supplies: [], paymentMethods: [], date: movement.date, filialId: "pdv" });
  assert.deepEqual(parsed.map(row => row.identitySource).sort(), ["provider", "synthetic"]);
  assert.equal(withdrawalSources(closure, [{ ...line, metadata: { withdrawalCents: 1000, cashMovements: [{ ...movement, identitySource: undefined }] } }]).sources[0].identityVerified, false);
});

test("fontes positivas cash; total, operador, repetição e movimento não atribuído são invariantes", () => {
  assert.deepEqual(withdrawalSources(closure, [line]).issues, []);
  for (const result of [
    withdrawalSources(closure, [{ ...line, metadata: { ...line.metadata, withdrawalCents: 999 } }]),
    withdrawalSources(closure, [line, { ...line, id: "another" }]),
    withdrawalSources({ ...closure, source: { ...closure.source, unassignedMovementCount: 1 } }, [line]),
    withdrawalSources(closure, [{ ...line, operatorId: "other" }]),
  ]) assert.throws(() => assertWithdrawalSourceIntegrity(result));
  const empty = withdrawalSources(closure, [{ ...line, metadata: { withdrawalCents: 0, cashMovements: [
    { ...movement, amountCents: 0 }, { ...movement, cancelled: true }, { ...movement, isCash: false }, { ...movement, kind: "supply" },
  ] } }]);
  assert.deepEqual(empty, { sources: [], issues: [] });
});

test("chave idempotente é estável e fingerprint muda com valor/data/operador", () => {
  const next = withdrawalSources(closure, [{ ...line, metadata: { withdrawalCents: 2000, cashMovements: [{ ...movement, amountCents: 2000 }] } }]).sources[0];
  assert.equal(next.sourceId, source.sourceId);
  assert.notEqual(next.fingerprint, source.fingerprint);
});

test("schema não aceita valor/data/unit enviados nem correção sem motivo", () => {
  const valid = { action: "create", sourceId: source.sourceId, fingerprint: source.fingerprint, accountPlanId: "account", resultCenterId: "center", description: "Despesa" };
  assert.equal(withdrawalClassificationSchema.safeParse(valid).success, true);
  assert.equal(withdrawalClassificationSchema.safeParse({ ...valid, amountCents: 1 }).success, false);
  assert.equal(withdrawalClassificationSchema.safeParse({ ...valid, accountPlanId: "accounts/a" }).success, false);
  assert.equal(withdrawalClassificationSchema.safeParse({ action: "unlink", sourceId: source.sourceId }).success, false);
});

const expense = { totalValue: 10, status: "pending", paymentMethod: "single", competenceMonth: "2026-09", resultCenterId: "center",
  accountPlan: "account", obligationId: "obl_avulsa", dueDate: "2026-09-03", installments: [{ number: 1, dueDate: "2026-09-03", value: 10, status: "pending" }] };
test("avulsa real: aceita referência de obrigação/parcela única e legado somente no workspace configurado", () => {
  assert.doesNotThrow(() => assertEligibleWithdrawalExpense(expense, source, "coala"));
  assert.throws(() => assertEligibleWithdrawalExpense(expense, { ...source, workspaceId: "other" }, "coala"));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, workspaceId: "other" }, source, "coala"));
  for (const patch of [{ totalValue: 11 }, { competenceMonth: "2026-10" }, { status: "paid" }, { provisionType: "forecast" },
    { plannedPaymentMethodType: "pix" }, { hasAccountAllocations: true }, { paymentRequestId: "request" },
    { installments: [{ ...expense.installments[0], status: "paid" }] }, { installments: [{ ...expense.installments[0], value: 9 }] },
    { installments: [{ ...expense.installments[0], dueDate: "2026-10-03" }] }]) {
    assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, ...patch }, source, "coala"));
  }
});

test("guard ignora somente apresentação; quitação na origem não simula conciliação bancária", () => {
  assert.equal(sourceExpenseGuard(expense), sourceExpenseGuard({ ...expense, notes: "anexo", attachments: ["pdf"], updatedAt: "today" }));
  assert.notEqual(sourceExpenseGuard(expense), sourceExpenseGuard({ ...expense, totalValue: 11 }));
  for (const kind of ["cash_withdrawal", "acquirer_fee"]) assert.throws(() => assertExpenseAllowsNewPayment({ sourceSettlement: { kind } }));
  assert.throws(() => assertExpenseAllowsNewPayment({ sourceSettlement: null }));
  assert.doesNotThrow(() => assertExpenseAllowsNewPayment(expense));
  const summary = sourceSettlementSummary(1000);
  assert.equal(summary.balanceAmountCents, 0);
  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.confirmedCashAmountCents, 0);
  assert.equal(summary.reconciliationStatus, "NOT_FOUND");
});
