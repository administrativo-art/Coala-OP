import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudgetConsumption, calculateBudgetForecastCoverage, type BudgetExpense } from "../../src/features/financial/lib/budget-consumption";
import { budgetCoverageSchema, createBudgetSchema, createBudgetRuleSchema, updateBudgetSchema } from "../../src/features/financial/budgets/schemas";
import { changeBudgetClaim, claimConflicts, type BudgetClaim } from "../../src/features/financial/budgets/claims";
import { budgetDocumentFingerprint, buildBudgetResidualProjections, makeBudgetCoverage, materializeBudgetComposition, summarizeBudgetPeople } from "../../src/features/financial/budgets/composition";
import { assertBudgetEmployeeEligible, assertCanonicalBudgetPersonLink } from "../../src/features/financial/budgets/references";
import { budgetSummaryForViewer, budgetRuleForViewer, canEditBudgetPersonnel, canViewBudgetPersonnel } from "../../src/features/financial/budgets/personnel-access";
import type { FinancialBudget, FinancialBudgetRule, FinancialBudgetSummary } from "../../src/features/financial/budgets/types";
import type { ServerUserContext } from "../../src/lib/auth-server";

const line = { id: "line-a", employeeId: "op-a", employeeName: "Pessoa sintética A", accountPlanId: "vt", amountCents: 21000, expectedPurchaseDate: "2026-09-30", estimateSource: "manual" as const };
const budget: FinancialBudget = { id: "budget-a", name: "VT sintético", competenceMonth: "2026-10", accountPlanIds: ["vt"],
  budgetedAmountCents: 21000, resultCenterId: "center-a", resultCenterName: "Centro A", composition: [line],
  active: true, source: "manual", ruleId: null, calculationMode: "manual", calculationSnapshot: null,
  createdBy: "actor", createdAt: "2026-09-01", updatedAt: "2026-09-01" };
const part = (employeeId: string, resultCenter: string, amount: number) => ({
  id: `${employeeId}-${resultCenter}`, employeeId, employeeName: "Pessoa sintética", accountPlanId: "vt", resultCenter, amount, analysisType: "employer_cost" as const,
});
const actual: BudgetExpense = { id: "boleto", competenceMonth: "2026-10", status: "pending", provisionType: "actual",
  accountId: "vt", totalValue: 201.60, hasPersonAllocations: true, personAllocations: [part("op-a", "center-a", 201.60)] };
const confirm = (b = budget, rows = [actual], state: "partial" | "final" = "final", residualAmountCents?: number) =>
  makeBudgetCoverage(b, rows, { lineId: b.composition![0].id, state, documentIds: rows.map((r) => r.id), reason: "Conferência sintética", residualAmountCents }, "actor", "2026-09-26T12:00:00Z");

test("suporte documental e prévia vencida invalidam conferência sem depender da baixa", () => {
  const closed = { ...budget, coverage: [confirm()] };
  for (const change of [{ documentIdentity: { barcodeHash: "new" } }, { fiscalIdentity: { documentNumber: "42" } },
    { boletoAttachment: { sha256: "changed" } }, { financialInboxMessageId: "other" }, { sourceDocumentSha256: "replacement" }]) {
    assert.equal(summarizeBudgetPeople(closed, [{ ...actual, ...change }]).people[0].coverageState, "invalidated");
  }
  assert.throws(() => makeBudgetCoverage(budget, [actual], { lineId: line.id, state: "final", documentIds: [actual.id],
    documentFingerprints: { [actual.id]: "old" }, reason: "Conferência anterior" }, "actor", "now"));
});

test("dispensa explícita não apaga orçamento; documento novo reabre conferência; desligamento não cancela boleto", () => {
  const coverage = makeBudgetCoverage(budget, [], { lineId: line.id, state: "not_required", documentIds: [], reason: "Pessoa não participará" }, "actor", "now");
  const closed = { ...budget, coverage: [coverage] };
  assert.equal(summarizeBudgetPeople(closed, []).residualAmountCents, 0);
  assert.equal(summarizeBudgetPeople(closed, []).people[0].balanceAmountCents, 21000);
  assert.equal(summarizeBudgetPeople(closed, [actual]).people[0].coverageState, "invalidated");
  assert.throws(() => makeBudgetCoverage(budget, [actual], { lineId: line.id, state: "not_required", documentIds: [], reason: "Não pode dispensar" }, "actor", "now"));
  const stopped = { ...budget, expectationStops: [{ lineId: line.id, terminationProcessId: "end", terminationDate: "2026-09-20", stoppedBy: "actor", stoppedAt: "now" }] };
  assert.equal(summarizeBudgetPeople(stopped, [actual]).residualAmountCents, 0);
  assert.equal(calculateBudgetConsumption(stopped, [actual]).consumedAmountCents, 20160);
  assert.equal(actual.status, "pending");
});

test("centro ausente em uma parcela não atribui boleto inteiro à matriz", () => {
  const mixed = { ...actual, totalValue: 100, resultCenter: "admin", personAllocations: [part("op-a", "center-a", 60), { ...part("op-b", "unknown", 40), resultCenter: null }] };
  assert.equal(calculateBudgetConsumption(budget, [mixed]).consumedAmountCents, 6000);
  assert.equal(calculateBudgetConsumption({ ...budget, resultCenterId: "admin" }, [mixed]).consumedAmountCents, 0);
  assert.ok(calculateBudgetConsumption(budget, [mixed]).issues.length);
});

test("claims legados globais, centros coexistentes, sobreposição e liberação preservam outros donos", () => {
  assert.equal(claimConflicts({ budgetId: "old" }, "center-a"), true);
  assert.equal(claimConflicts({ ruleId: "old" }, "center-a"), true);
  let claim = changeBudgetClaim(undefined, "center-a", "a", true)!;
  claim = changeBudgetClaim(claim, "center-b", "b", true)!;
  assert.equal(claimConflicts(claim, "center-c"), false);
  assert.throws(() => changeBudgetClaim(claim, null, "global", true));
  assert.throws(() => changeBudgetClaim(claim, "center-a", "duplicate", true));
  const released = changeBudgetClaim(claim, "center-a", "a", false)!;
  assert.deepEqual(released.centerOwners, { "center-b": "b" });
  assert.deepEqual(changeBudgetClaim(released, "center-b", "not-owner", false), released);
  assert.equal(changeBudgetClaim({ budgetId: "legacy" }, null, "legacy", false), null);
});

test("concorrência otimista no lock compartilhado repete a leitura antes de aceitar global/local", async () => {
  // Deterministic unit harness for Firestore's optimistic retry semantics; not an emulator test.
  let persisted: BudgetClaim | undefined;
  let version = 0;
  async function transaction(center: string | null, owner: string) {
    for (;;) {
      const readVersion = version;
      const readClaim = structuredClone(persisted);
      await Promise.resolve();
      const next = changeBudgetClaim(readClaim, center, owner, true)!;
      if (readVersion !== version) continue;
      persisted = next; version++; return owner;
    }
  }
  const results = await Promise.allSettled([transaction(null, "global"), transaction("center-a", "local")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  persisted = undefined; version = 0;
  assert.equal((await Promise.all([transaction("a", "a"), transaction("b", "b")])).length, 2);
  assert.equal(Object.keys(persisted!.centerOwners!).length, 2);
});

test("boleto único e mesma pessoa em três centros fecham centavos sem duplicar cabeçalho administrativo", () => {
  const shared = { ...actual, resultCenter: "administrativo", totalValue: 100,
    personAllocations: [part("op-a", "center-a", 33.33), part("op-a", "center-b", 33.33), part("op-a", "center-c", 33.34)] };
  const totals = ["center-a", "center-b", "center-c"].map((resultCenterId) => calculateBudgetConsumption({ ...budget, resultCenterId }, [shared]).consumedAmountCents);
  assert.deepEqual(totals, [3333, 3333, 3334]);
  assert.equal(totals.reduce((a, b) => a + b), 10000);
  assert.equal(calculateBudgetConsumption({ ...budget, resultCenterId: "administrativo" }, [shared]).consumedAmountCents, 0);
  assert.equal(summarizeBudgetPeople({ ...budget, resultCenterId: "center-b" }, [shared]).people[0].committedAmountCents, 3333);
});

test("rateio percentual reconcilia centavos por conta preservando consumo global", () => {
  const expense = { ...actual, hasPersonAllocations: false, personAllocations: null, totalValue: 0.01, isApportioned: true,
    apportionments: [{ resultCenter: "a", percentage: 50 }, { resultCenter: "b", percentage: 50 }] };
  const a = calculateBudgetConsumption({ ...budget, resultCenterId: "a" }, [expense]).consumedAmountCents;
  const b = calculateBudgetConsumption({ ...budget, resultCenterId: "b" }, [expense]).consumedAmountCents;
  assert.equal(a + b, 1);
  assert.equal(calculateBudgetConsumption({ ...budget, resultCenterId: undefined }, [expense]).consumedAmountCents, 1);
});

test("somente conta e centro elegíveis consomem; forecasts/draft/cancelled/reconciled excluídos", () => {
  const excluded: BudgetExpense[] = ["draft", "cancelled", "reconciled"].map((status) => ({ ...actual, status }));
  excluded.push({ ...actual, provisionType: "forecast" });
  assert.equal(calculateBudgetConsumption(budget, excluded).consumedAmountCents, 0);
  assert.equal(calculateBudgetConsumption({ ...budget, resultCenterId: "other" }, [actual]).consumedAmountCents, 0);
  assert.equal(calculateBudgetConsumption({ ...budget, accountPlanIds: ["other"] }, [actual]).consumedAmountCents, 0);
  assert.equal(calculateBudgetForecastCoverage(budget, [{ ...actual, provisionType: "forecast", status: "provisioned" }]), 0);
});

test("final explícito deixa sobra e residual zero; parcial conserva residual por pessoa e revisão justificada", () => {
  const open = summarizeBudgetPeople(budget, [actual]).people[0];
  assert.equal(open.residualAmountCents, 840);
  assert.equal(open.coverageState, "partial");
  const closed = summarizeBudgetPeople({ ...budget, coverage: [confirm()] }, [actual]).people[0];
  assert.equal(closed.balanceAmountCents, 840);
  assert.equal(closed.residualAmountCents, 0);
  const partial = summarizeBudgetPeople({ ...budget, coverage: [confirm(budget, [actual], "partial", 5000)] }, [actual]).people[0];
  assert.equal(partial.residualAmountCents, 5000);
  assert.equal(partial.balanceAmountCents, 840);
  assert.throws(() => makeBudgetCoverage(budget, [actual], { lineId: line.id, state: "final", documentIds: ["unrelated"], reason: "Conferido" }, "actor", "now"));
});

test("pagamento e seu estorno preservam final; cancelamento, centro, competência, valor e complemento invalidam", () => {
  const closed = { ...budget, coverage: [confirm()] };
  for (const status of ["paid", "pending", "partially_paid"]) {
    assert.equal(summarizeBudgetPeople(closed, [{ ...actual, status }]).people[0].coverageState, "final");
  }
  for (const changed of [{ ...actual, status: "cancelled" }, { ...actual, competenceMonth: "2026-11" },
    { ...actual, totalValue: 200, personAllocations: [part("op-a", "center-a", 200)] },
    { ...actual, personAllocations: [part("op-a", "center-b", 201.60)] }]) {
    assert.equal(summarizeBudgetPeople(closed, [changed]).people[0].coverageState, "invalidated");
  }
  assert.equal(summarizeBudgetPeople(closed, [actual, { ...actual, id: "complement" }]).people[0].coverageState, "invalidated");
  assert.equal(budgetDocumentFingerprint(actual).length, 64);
});

test("estouro, pessoa não prevista e parcela sem identificação não desaparecem do total", () => {
  const extra = { ...actual, totalValue: 400, personAllocations: [part("op-a", "center-a", 300), part("op-extra", "center-a", 100)] };
  const summary = summarizeBudgetPeople(budget, [extra]);
  assert.equal(summary.people[0].balanceAmountCents, -9000);
  assert.equal(summary.people[0].residualAmountCents, 0);
  assert.equal(summary.outsideCompositionAmountCents, 10000);
  assert.equal(calculateBudgetConsumption(budget, [extra]).consumedAmountCents, 40000);
  const unidentified = { ...actual, hasPersonAllocations: false, personAllocations: null, resultCenter: "center-a" };
  assert.equal(summarizeBudgetPeople(budget, [unidentified]).unidentifiedAmountCents, 20160);
  const invalid = { ...actual, resultCenter: "center-a", personAllocations: [part("op-a", "center-a", 10)] };
  assert.equal(calculateBudgetConsumption(budget, [invalid]).consumedAmountCents, 20160);
  assert.equal(summarizeBudgetPeople(budget, [invalid]).unidentifiedAmountCents, 20160);
  assert.ok(calculateBudgetConsumption(budget, [{ ...invalid, resultCenter: null }]).issues.length);
});

test("fixture sintética 141960/106680: duas ausentes somam residual40320, não saldo35280", () => {
  const amounts = [21000, 21000, 21000, 21000, 17640, 20160, 20160];
  const b = { ...budget, budgetedAmountCents: 141960, composition: amounts.map((amountCents, index) => ({ ...line, id: `line-${index}`, employeeId: `op-${index}`, amountCents })) };
  const e = { ...actual, totalValue: 1066.80, personAllocations: [210, 210, 210, 210, 226.80].map((amount, index) => part(`op-${index}`, "center-a", amount)) };
  b.coverage = b.composition.slice(0, 5).map((l) => makeBudgetCoverage(b, [e], { lineId: l.id, state: "final", documentIds: [e.id], reason: "Conferência sintética" }, "actor", "now"));
  assert.equal(calculateBudgetConsumption(b, [e]).balanceAmountCents, 35280);
  assert.equal(summarizeBudgetPeople(b, [e]).residualAmountCents, 40320);
  const projection = buildBudgetResidualProjections([b], [e], { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(projection.projections.length, 2);
  assert.equal(projection.replacementKeys.length, 7);
  assert.equal(projection.projections.reduce((sum, p) => sum + p.amountCents, 0), 40320);
  assert.ok(projection.projections.every((p) => p.competenceMonth === "2026-10" && p.expectedPurchaseDate === "2026-09-30" && p.requiresReview));
});

test("forecast legado bloqueia projeção nova mesmo em centro administrativo, por três identidades compatíveis", () => {
  for (const identity of [{ employeeId: "op-a" }, { employeeUserId: "op-a" }, { provisionSeriesKey: "recurring:vale-transporte:op-a" }]) {
    const forecast = { id: "legacy", competenceMonth: "2026-10", status: "provisioned", provisionType: "forecast", accountId: "vt", resultCenter: "admin", totalValue: 210, ...identity };
    const result = buildBudgetResidualProjections([budget], [forecast]);
    assert.equal(result.projections.length, 0);
    assert.deepEqual(result.conflicts[0].forecastIds, ["legacy"]);
    assert.equal(result.replacementKeys.length, 0);
    assert.equal(buildBudgetResidualProjections([budget], [{ ...forecast, status: "cancelled" }]).projections.length, 1);
    assert.equal(buildBudgetResidualProjections([budget], [{ ...forecast, accountId: "other" }]).conflicts.length, 0);
  }
});

test("data de compra mês anterior ajusta fim de mês e preserva ID/valor do snapshot", () => {
  const composition = [{ ...line, purchaseDay: 31, purchaseMonthOffset: -1 as const }];
  const march = materializeBudgetComposition({ composition }, "2026-03")!;
  assert.equal(march[0].expectedPurchaseDate, "2026-02-28");
  assert.equal(materializeBudgetComposition({ composition }, "2028-03")![0].expectedPurchaseDate, "2028-02-29");
  assert.equal(march[0].id, line.id);
  assert.equal(march[0].amountCents, line.amountCents);
  assert.equal(materializeBudgetComposition({ composition }, "2026-01")![0].expectedPurchaseDate, "2025-12-31");
});

test("schemas aceitam legado e rejeitam duplicatas, soma divergente e modos nominais não sustentados", () => {
  assert.ok(createBudgetSchema.safeParse({ name: "Global legado", competenceMonth: "2026-10", accountPlanIds: ["vt"], budgetedAmountCents: 1 }).success);
  assert.ok(createBudgetSchema.safeParse(budget).success);
  assert.equal(createBudgetSchema.safeParse({ ...budget, budgetedAmountCents: 0 }).success, false);
  for (const duplicate of [line, { ...line, id: "another-id" }, { ...line, employeeId: "op-b" }]) {
    assert.equal(createBudgetSchema.safeParse({ ...budget, composition: [line, duplicate], budgetedAmountCents: 42000 }).success, false);
    assert.equal(updateBudgetSchema.safeParse({ composition: [line, duplicate], reason: "Conferência" }).success, false);
  }
  assert.equal(createBudgetSchema.safeParse({ ...budget, composition: [{ ...line, expectedPurchaseDate: "2026-02-30" }] }).success, false);
  const rule = { name: "Regra VT", accountPlanIds: ["vt"], mode: "fixed", fixedAmountCents: 21000, startMonth: "2026-10", resultCenterId: "center-a",
    composition: [{ ...line, purchaseDay: 30, purchaseMonthOffset: -1 }] };
  assert.ok(createBudgetRuleSchema.safeParse(rule).success);
  assert.equal(createBudgetRuleSchema.safeParse({ ...rule, mode: "expense_average" }).success, false);
  assert.equal(createBudgetRuleSchema.safeParse({ ...rule, mode: "consumption_price", baseProductIds: ["p"], stockKioskId: "matriz" }).success, false);
  assert.equal(createBudgetRuleSchema.safeParse({ ...rule, generationLeadMonths: 2 }).success, false);
  assert.equal(createBudgetRuleSchema.safeParse({ ...rule, endMonth: "2026-09" }).success, false);
  assert.equal(createBudgetRuleSchema.safeParse({ ...rule, fixedAmountCents: 42000, composition: [...rule.composition, ...rule.composition] }).success, false);
  assert.equal(budgetCoverageSchema.safeParse({ lineId: line.id, state: "final", documentIds: ["e"], reason: "Conferência" }).success, false);
  assert.equal(budgetCoverageSchema.safeParse({ lineId: line.id, state: "final", documentIds: ["e", "e"], reason: "Conferência", confirmed: true }).success, false);
});

test("eligibilidade exige atividade e admissão confiável, mantendo OP distinto do ID RH", () => {
  const employee = { exists: true, status: "active", name: "Pessoa sintética", admissionDate: "2026-01-10", hasTerminationProcess: false };
  assert.doesNotThrow(() => assertBudgetEmployeeEligible(employee, "2026-10"));
  for (const changed of [{ ...employee, status: "terminated" }, { ...employee, admissionDate: null },
    { ...employee, opIsActive: false },
    { ...employee, admissionDate: "2026-11-01" }, { ...employee, admissionDate: "2026-02-30" },
    { ...employee, admissionDate: "2026-99-30" }, { ...employee, hasTerminationProcess: true }]) {
    assert.throws(() => assertBudgetEmployeeEligible(changed, "2026-10"));
  }
  assert.doesNotThrow(() => assertCanonicalBudgetPersonLink({ requestedId: "op-a", userId: "op-a", employeeId: "bizneo-external-1", linkedUserIds: ["op-a"] }));
  assert.throws(() => assertCanonicalBudgetPersonLink({ requestedId: "bizneo-external-1", userId: "op-a", employeeId: "bizneo-external-1", linkedUserIds: ["op-a"] }));
  assert.throws(() => assertCanonicalBudgetPersonLink({ requestedId: "op-a", userId: "op-a", employeeId: "rh-a", linkedUserIds: ["op-b"] }));
});

test("permissões pessoais combinadas e redaction preservam agregados/hasComposition sem nomes", () => {
  const actor = { isDefaultAdmin: false, permissions: { financial: { view: true, settings: { view: true, manageBudgets: true }, personnelCosts: { view: false, edit: true } } } } as ServerUserContext;
  assert.equal(canViewBudgetPersonnel(actor), false);
  assert.equal(canEditBudgetPersonnel(actor), false);
  actor.permissions.financial!.personnelCosts!.view = true;
  assert.equal(canEditBudgetPersonnel(actor), true);
  actor.permissions.financial!.settings!.manageBudgets = false;
  assert.equal(canEditBudgetPersonnel(actor), false);
  const summary = { ...budget, name: "Pessoa sintética A", ...calculateBudgetConsumption(budget, [actual]),
    ...summarizeBudgetPeople(budget, [actual]), coverage: [confirm()], hasComposition: true,
    forecastCoverageAmountCents: 0, curve: [] } satisfies FinancialBudgetSummary;
  const safe = budgetSummaryForViewer(summary, false);
  assert.equal(safe.hasComposition, true);
  assert.equal(safe.residualAmountCents, 840);
  assert.equal(safe.composition, undefined);
  assert.equal(safe.people, undefined);
  assert.equal(safe.coverage, undefined);
  assert.equal(JSON.stringify(safe).includes("Pessoa sintética"), false);
  assert.equal(budgetSummaryForViewer(summary, true), summary);
  const normal = budgetSummaryForViewer({ ...summary, composition: undefined, hasComposition: false, name: "Insumos" }, false);
  assert.equal(normal.name, "Insumos");
  const rule = { ...budget, name: "Pessoa sintética A", mode: "fixed", fixedAmountCents: 21000, averageMonths: 3,
    baseProductIds: [], stockKioskId: null, closingStockDays: 7, startMonth: "2026-10",
    composition: [{ ...line, purchaseDay: 30, purchaseMonthOffset: -1 as const }] } satisfies FinancialBudgetRule;
  assert.equal(budgetRuleForViewer(rule, false).composition, undefined);
  assert.equal(JSON.stringify(budgetRuleForViewer(rule, false)).includes("Pessoa sintética"), false);
});
