import assert from "node:assert/strict";
import test from "node:test";
import { analyzeManagement, managementPeriod, managementRequestSchema, FEE_ACCOUNTS } from "../../src/features/financial/agent/management";
import type { DreSourceDataPayload } from "../../src/features/financial/dre/source-data";
import type { ReceivablePeriodResult } from "../../src/features/financial/receivables/period-review";
const request = managementRequestSchema.parse({ kioskId: "unit", mappingId: "mapping", stoneCode: "123", month: "2026-09" });
function source(): DreSourceDataPayload { return { expenses: [
  { id: "expense", accountingContractVersion: 1, competenceMonth: "2026-09", status: "paid", totalValue: 100,
    accountId: "cost", resultCenter: "unit", hasAccountAllocations: false, hasPersonAllocations: false, isApportioned: false },
], salesSummaries: [{ kioskId: "unit", year: 2026, month: 9, revenue: 1000, cmv: 200 }], closureSummaries: [], missingSimulationIds: [],
stats: { expenseDocuments: 1, salesReportDocuments: 1, closureSummaryDocuments: 0, simulationDocuments: 1 } }; }
function input() { return { request, source: source(), accounts: { cost: { name: "Cost", drePosition: "despesas_operacionais", isDreAccount: true } },
  centerName: "Unit", centerNames: { unit: "Unit" }, cash: { movements: [], excludedCount: 0, confirmedBalance: null }, receivables: null }; }
test("management validates bounded request and calendar month", () => {
  assert.equal(managementRequestSchema.safeParse({ ...request, workspaceId: "foreign" }).success, false);
  assert.equal(managementRequestSchema.safeParse({ ...request, month: "2026-13" }).success, false);
  assert.equal(managementRequestSchema.safeParse({ ...request, budgetExpenseCents: 0.1 }).success, false);
  assert.deepEqual(managementPeriod("2024-02"), { from: "2024-02-01", through: "2024-02-29", previous: "2024-01" });
});
test("DRE reuses allocation contract, excludes other units and preserves missing history", () => {
  const data = input(); data.source.expenses.push({ ...data.source.expenses[0], id: "foreign", resultCenter: "Other", totalValue: 9999 });
  const result = analyzeManagement(data);
  assert.equal(result.months[1].expenseTotal, 100); assert.equal(result.months[1].result, 700);
  assert.equal(result.months[0].revenue, null); assert.equal(result.months[0].result, null);
  assert.equal(result.expenseChangeCents, null); assert.ok(result.alerts.every(alert => alert.code !== "history"));
  assert.equal(result.budgetDifferenceCents, null); assert.equal(result.cash.confirmedBalance, null);
  assert.equal(result.cash.projectedBalanceCents, null); assert.equal(result.writesPerformed, false);
});
test("explicit budget and materiality generate traceable alerts, never approved spending", () => {
  const result = analyzeManagement({ ...input(), request: { ...request, budgetExpenseCents: 5000, materialityCents: 1000 } });
  assert.equal(result.budgetDifferenceCents, 5000); assert.ok(result.alerts.some(alert => alert.code === "budget"));
  assert.ok(result.alerts.every(alert => alert.href.startsWith("/dashboard/financial/")));
});
test("missing CMV or accounting issues prevent a fabricated net result", () => {
  const data = input(); data.source.missingSimulationIds.push("missing");
  assert.equal(analyzeManagement(data).months[1].result, null);
  const missingAccount = input(); missingAccount.source.expenses[0].accountId = "missing";
  assert.equal(analyzeManagement(missingAccount).months[1].result, null);
});
test("Stone payments and early-paid installments are not forecast again or counted as bank receipts", () => {
  const receivables = { rows: [
    { transactionId: "t1", installment: 1, saleDate: "2026-09-01", dueDate: "2026-10-01", status: "projected", originalNet: "98.00", paidNet: null, mdr: "2.00", sourceFileIds: ["f1"] },
    { transactionId: "t2", installment: 1, saleDate: "2026-09-01", dueDate: "2026-10-01", status: "paid_early", originalNet: "98.00", paidNet: "95.00", mdr: "2.00", sourceFileIds: ["f2"] },
  ] } as ReceivablePeriodResult;
  const result = analyzeManagement({ ...input(), receivables });
  assert.equal(result.cash.forecastInCents, 9800); assert.equal(result.cash.bankInCents, 0);
  assert.equal(result.fees.find(row => row.kind === "anticipation")?.amountCents, 300);
  assert.equal(result.fees.find(row => row.kind === "anticipation")?.basis, "net_difference_not_classified");
  assert.equal(result.fees.find(row => row.kind === "anticipation")?.sourcePending, true);
  assert.equal(result.fees.find(row => row.kind === "mdr")?.accountId, FEE_ACCOUNTS.mdr);
  assert.ok(result.fees.every(row => row.status === "human_review_required" && row.accountName === null));
});
test("reported payments stay separate from bank-confirmed cash", () => {
  const result = analyzeManagement({ ...input(), cash: { confirmedBalance: null, excludedCount: 0, movements: [
    { id: "a", date: "2026-09-01", status: "reported", direction: "in", amountCents: 10000, expenseId: null },
    { id: "b", date: "2026-09-01", status: "bank_confirmed", direction: "in", amountCents: 2000, expenseId: null },
    { id: "c", date: "2026-09-02", status: "forecast", direction: "out", amountCents: 500, expenseId: "expense" },
  ] } });
  assert.equal(result.cash.bankInCents, 2000); assert.equal(result.cash.forecastOutCents, 500);
});
