import assert from "node:assert/strict";
import test from "node:test";

import { assertSalaryPaymentTarget } from "../../../src/features/financial/payment-requests/salary-payment";

const input = {
  sourceId: "salary_202609_auth-employee",
  expenseId: "salary_202609_auth-employee",
  beneficiaryReference: { sourceType: "employee" as const, sourceId: "employee-hr" },
  amount: 1768.82,
  description: "Salário - 09/2026 | Pessoa Teste",
  scheduledFor: "2026-10-06",
};
const expense = {
  workspaceId: "coala",
  status: "pending",
  provisionType: "actual",
  payrollEarningType: "salary",
  employeeId: "auth-employee",
  totalValue: 1768.82,
  description: input.description,
};
const employee = { id: "employee-hr", authUid: "auth-employee" };

test("valida a despesa, o colaborador e o valor do salário", () => {
  assert.doesNotThrow(() => assertSalaryPaymentTarget(input, expense, employee));
});

test("bloqueia favorecido que não corresponde ao colaborador da despesa", () => {
  assert.throws(
    () => assertSalaryPaymentTarget(input, expense, { id: "employee-hr", authUid: "outro" }),
    /não corresponde/,
  );
});

test("bloqueia valor, descrição, estado e origem divergentes", () => {
  assert.throws(() => assertSalaryPaymentTarget({ ...input, amount: 1768.81 }, expense, employee), /valor/);
  assert.throws(() => assertSalaryPaymentTarget({ ...input, description: "Outro" }, expense, employee), /descrição/);
  assert.throws(() => assertSalaryPaymentTarget(input, { ...expense, status: "paid" }, employee), /pendente/);
  assert.throws(() => assertSalaryPaymentTarget({ ...input, sourceId: "outra" }, expense, employee), /própria despesa/);
});
