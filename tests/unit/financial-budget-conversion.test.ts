import assert from "node:assert/strict";
import test from "node:test";
import { assertForecastConversionDestinations, forecastConversionCandidate, forecastConversionSchema } from "../../src/features/financial/budgets/forecast-conversion";

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

const split = { ...source, isApportioned: true, hasPersonAllocations: true,
  apportionments: [33.33, 33.33, 33.34].map((percentage, i) => ({ resultCenter: `center-${i}`, percentage })),
  personAllocations: [0, 1, 2].map((i) => ({ employeeId: "person", employeeName: "Pessoa", accountPlanId: "vt",
    amount: 70, resultCenter: `center-${i}`, analysisType: "employer_cost" as const })),
};

test("conversão aceita VT individual rateado com valores explícitos por centro", () => {
  const candidate = forecastConversionCandidate(split, "2026-10");
  assert.equal(candidate.amountCents, 21000);
  assert.deepEqual(candidate.centerAmounts, [0, 1, 2].map((i) => ({ resultCenterId: `center-${i}`, amountCents: 7000 })));
});

test("rateio não libera origem incompleta, divergente, de outra pessoa/conta ou com atividade financeira", () => {
  const changes = [
    { hasPersonAllocations: false }, { personAllocations: [] }, { apportionments: [] },
    { apportionments: split.apportionments.map((p) => ({ ...p, resultCenter: undefined })) },
    { apportionments: split.apportionments.map((p) => ({ ...p, resultCenter: "center-0" })) },
    { apportionments: split.apportionments.map((p) => ({ ...p, percentage: 30 })) },
    { apportionments: [50, 25, 25].map((percentage, i) => ({ resultCenter: `center-${i}`, percentage })) },
    { personAllocations: split.personAllocations.map((p) => ({ ...p, employeeId: "other" })) },
    { personAllocations: split.personAllocations.map((p) => ({ ...p, resultCenter: "missing" })) },
    { personAllocations: split.personAllocations.map((p) => ({ ...p, amount: 69 })) },
    { hasAccountAllocations: true }, { paymentRequestId: "payment" }, { paidAt: "2026-09-26" },
    { attachments: [{ id: "pdf" }] }, { settlementSummary: { actualAmountCents: 21000 } },
  ];
  for (const change of changes) assert.throws(() => forecastConversionCandidate({ ...split, ...change }, "2026-10"), JSON.stringify(change));
});

test("destinos conservam cada centro, não apenas o total do rateio", () => {
  const candidate = forecastConversionCandidate(split, "2026-10");
  const centers = candidate.centerAmounts!;
  assert.doesNotThrow(() => assertForecastConversionDestinations(candidate, centers));
  assert.doesNotThrow(() => assertForecastConversionDestinations(candidate, [...centers].reverse()));
  for (const targets of [
    [{ resultCenterId: "matrix", amountCents: 21000 }],
    centers.map((p, i) => ({ ...p, amountCents: p.amountCents + (i === 0 ? 100 : i === 1 ? -100 : 0) })),
    centers.map((p) => ({ ...p, resultCenterId: "center-0" })),
    centers.map((p) => ({ ...p, amountCents: p.amountCents + 1 })),
  ]) assert.throws(() => assertForecastConversionDestinations(candidate, targets));
});
