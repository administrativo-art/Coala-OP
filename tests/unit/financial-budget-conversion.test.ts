import assert from "node:assert/strict";
import test from "node:test";
import { forecastConversionCandidate, forecastConversionSchema } from "../../src/features/financial/budgets/forecast-conversion";

const source = { id: "forecast", employeeId: "person", provisionSeriesKey: "recurring:vale-transporte:person",
  provisionType: "forecast" as const, status: "provisioned", competenceMonth: "2026-10", dueDate: "2026-09-30", accountId: "vt", totalValue: 210 };
test("conversão preserva data civil e exige origem simples, coerente e sem documento real", () => {
  assert.equal(forecastConversionCandidate(source, "2026-10").expectedPurchaseDate, "2026-09-30");
  for (const change of [{ dueDate: "2026-02-30" }, { employeeId: "another" }, { employeeUserId: "another" },
    { totalValue: 0 }, { status: "paid" }, { attachments: [{ id: "pdf" }] }, { documentIdentity: { sha256: "hash" } },
    { fiscalIdentity: { number: "123" } }, { budgetMigration: {} }, { settlementSummary: { reconciliationStatus: "MATCHED" } },
    { hasPersonAllocations: true, personAllocations: [] }]) {
    assert.throws(() => forecastConversionCandidate({ ...source, ...change }, "2026-10"), JSON.stringify(change));
  }
  const part = { employeeId: "another", employeeName: "Outra pessoa", accountPlanId: "vt", amount: 210, resultCenter: "center", analysisType: "employer_cost" as const };
  assert.throws(() => forecastConversionCandidate({ ...source, hasPersonAllocations: true, personAllocations: [part] }, "2026-10"));
  assert.equal(forecastConversionCandidate({ ...source, hasPersonAllocations: true, personAllocations: [{ ...part, employeeId: "person" }] }, "2026-10").amountCents, 21000);
});
test("conversão rejeita origem ou linha de destino duplicada", () => {
  const mapping = { expenseId: "forecast", destinations: [{ budgetId: "budget", lineId: "line" }] };
  const input = { month: "2026-10", reason: "Conversão revisada", mappings: [mapping] };
  assert.equal(forecastConversionSchema.safeParse(input).success, true);
  assert.equal(forecastConversionSchema.safeParse({ ...input, mappings: [mapping, mapping] }).success, false);
  assert.equal(forecastConversionSchema.safeParse({ ...input, mappings: [mapping, { ...mapping, expenseId: "other" }] }).success, false);
});
