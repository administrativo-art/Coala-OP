import assert from "node:assert/strict";
import test from "node:test";

import { assertConsultancyActualPaymentTarget, assertConsultancyProvisionPaymentTarget } from "../../../src/features/financial/payment-requests/consultancy-provision-payment";

const employee = { id: "employee-isabela", name: "Isabela Dominici Silva", status: "active" };
const input = {
  sourceId: "provision_isabela_2026_11", expenseId: "provision_isabela_2026_11",
  beneficiaryReference: { sourceType: "employee" as const, sourceId: employee.id },
  amount: 1050.78, description: "Consultoria de RH - 11/2026 | Isabela Dominici Silva", scheduledFor: "2026-11-20",
};
const forecast = {
  id: input.sourceId, workspaceId: "coala", status: "provisioned", provisionType: "forecast",
  provisionSeriesKey: "recurring:consultoria-rh:isabela-dominici-silva", provisionCompetence: "2026-11",
  supplier: employee.name, consultancyEmployeeId: employee.id, consultancyContractDocumentId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", description: input.description, totalValue: input.amount, dueDate: "2026-11-20T15:00:00.000Z",
  installments: [{ number: 1, dueDate: "2026-11-20T15:00:00.000Z", value: input.amount, status: "pending" }],
};

test("accepts one unpaid consulting forecast for its own beneficiary and due date", () => {
  assert.doesNotThrow(() => assertConsultancyProvisionPaymentTarget(input, forecast, employee));
  assert.doesNotThrow(() => assertConsultancyProvisionPaymentTarget(input, { ...forecast, workspaceId: undefined }, employee));
  assert.throws(() => assertConsultancyProvisionPaymentTarget(input, { ...forecast, workspaceId: "outro" }, employee));
});

test("blocks a different employee, date, amount or existing payment", () => {
  assert.throws(() => assertConsultancyProvisionPaymentTarget(input, forecast, { ...employee, name: "Outra pessoa" }));
  assert.throws(() => assertConsultancyProvisionPaymentTarget(input, { ...forecast, consultancyEmployeeId: null }, employee));
  assert.throws(() => assertConsultancyProvisionPaymentTarget({ ...input, scheduledFor: "2026-11-19" }, forecast, employee));
  assert.throws(() => assertConsultancyProvisionPaymentTarget({ ...input, amount: 1050.77 }, forecast, employee));
  assert.throws(() => assertConsultancyProvisionPaymentTarget(input, { ...forecast, paidAt: "2026-11-19" }, employee));
});

test("accepts only the deterministic real obligation linked to the forecast", () => {
  const actualId = `consultancy_actual_${input.sourceId}`;
  const actual = { ...forecast, id: actualId, status: "pending", provisionType: "actual", sourceType: "consultancy_contract_payment", reconciledProvisionId: input.sourceId };
  const request = { ...input, expenseId: actualId };
  assert.doesNotThrow(() => assertConsultancyActualPaymentTarget(request, actual, employee));
  assert.throws(() => assertConsultancyActualPaymentTarget(request, { ...actual, reconciledProvisionId: "other" }, employee));
  assert.throws(() => assertConsultancyActualPaymentTarget(request, { ...actual, paymentRequestId: "other-request" }, employee));
});
