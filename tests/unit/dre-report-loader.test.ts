import test from "node:test";
import assert from "node:assert/strict";
import { loadDreReportWithServices, type DreReportServices } from "../../src/features/financial/dre/report-loader";
import type { ServerUserContext } from "../../src/lib/auth-server";
import type { DreReportInput } from "../../src/features/financial/dre/report-access";
const input: DreReportInput = { month: "2026-10", mode: "monthly", format: "xlsx", kioskIds: ["a"] };
const actor = (unitIds: string[]) => ({ workspace_id: "coala", isDefaultAdmin: false, userDoc: { unitAccessScope: "selected", unitAccessUnitIds: unitIds }, permissions: { financial: { view: true, dre: true, expenses: { view: true } } } }) as unknown as ServerUserContext;
function fakeDatabase(shared: boolean) {
  const reads: Array<{ kioskIds: string[]; periods: string[]; workspaceId: string }> = [];
  const expenses = shared ? [{ id: "shared", accountingContractVersion: 1, competenceMonth: "2026-10", status: "pending", totalValue: 100, accountPlan: "op", resultCenter: "ab" }]
    : [{ id: "a-expense", accountingContractVersion: 1, competenceMonth: "2026-10", status: "pending", totalValue: 100, accountPlan: "op", resultCenter: "ca" }, { id: "b-expense", accountingContractVersion: 1, competenceMonth: "2026-10", status: "pending", totalValue: 900, accountPlan: "op", resultCenter: "cb" }];
  const services: DreReportServices = {
    now: () => new Date("2026-11-17T15:00:00Z"),
    readKiosks: async () => [{ id: "a", name: "A", pdvFilialId: "1" }, { id: "b", name: "B", pdvFilialId: "2" }],
    readCenters: async () => shared ? [{ id: "ab", name: "Grupo compartilhado", unitIds: ["a", "b"] }] : [{ id: "ca", name: "Centro A", unitIds: ["a"] }, { id: "cb", name: "Centro B", unitIds: ["b"] }],
    readAccounts: async ids => { assert.deepEqual(ids, ["op"]); return { op: { name: "Operacional", drePosition: "despesas_operacionais", isDreAccount: true } }; },
    readSources: async params => { reads.push(params); return { expenses, salesSummaries: [], closureSummaries: [], missingSimulationIds: [], stats: { salesReportDocuments: 0, simulationDocuments: 0, closureSummaryDocuments: 0, expenseDocuments: expenses.length } }; },
    readStock: async params => ({ kioskIds: params.kioskIds, periods: params.periods, stockSummaries: [], missingProductIds: [], missingBaseProductIds: [], unpricedBaseProductIds: [], stats: { movementDocuments: 0, productDocuments: 0, baseProductDocuments: 0, effectiveCostDocuments: 0 } }),
  };
  return { services, reads };
}
test("carregador recusa centro A+B para seleção A antes de ler valores, inclusive se ator só acessa A", async () => {
  for (const allowed of [["a"], ["a", "b"]]) { const db = fakeDatabase(true);
    await assert.rejects(loadDreReportWithServices(input, actor(allowed), db.services), /centro de resultado/); assert.equal(db.reads.length, 0);
  }
  const db = fakeDatabase(true); await assert.rejects(loadDreReportWithServices({ ...input, kioskIds: ["a", "b"] }, actor(["a"]), db.services)); assert.equal(db.reads.length, 0);
});
test("grupo completo autorizado inclui despesa uma vez; quiosques não recebem rateio inventado", async () => {
  const db = fakeDatabase(true); const report = await loadDreReportWithServices({ ...input, kioskIds: ["a", "b"] }, actor(["a", "b"]), db.services);
  assert.equal(report.months[0].metrics.despOp, 100); assert.equal(report.principalExpenses[0].amount, 100);
  assert.equal(report.months[0].units.length, 2); for (const unit of report.months[0].units) { assert.ok(Number.isNaN(unit.metrics.despOp)); assert.ok(Number.isNaN(unit.metrics.lucroLiq)); assert.deepEqual(unit.metrics.expenseDetailsByPosition, {}); }
  assert.match(report.permissionsNote!, /centro compartilhado/); assert.deepEqual(db.reads[0].kioskIds, ["a", "b"]); assert.equal(db.reads[0].workspaceId, "coala");
});
test("centros exclusivos mantêm escopo e conservação no carregador completo", async () => {
  const a = fakeDatabase(false), all = fakeDatabase(false);
  const subset = await loadDreReportWithServices(input, actor(["a"]), a.services);
  assert.equal(subset.months[0].metrics.despOp, 100); assert.equal(subset.principalExpenses[0].amount, 100);
  const full = await loadDreReportWithServices({ ...input, kioskIds: ["a", "b"] }, actor(["a", "b"]), all.services);
  assert.equal(full.months[0].metrics.despOp, 1000); assert.equal(full.months[0].units.reduce((sum, u) => sum + u.metrics.despOp, 0), 1000);
});
test("nomes ou aliases ambíguos e mais de um centro por unidade são recusados antes dos valores", async () => {
  const db = fakeDatabase(false); db.services.readCenters = async () => [{ id: "ca", name: "Igual", unitIds: ["a"] }, { id: "cb", name: "Igual", unitIds: ["b"] }];
  await assert.rejects(loadDreReportWithServices(input, actor(["a"]), db.services)); assert.equal(db.reads.length, 0);
  db.services.readCenters = async () => [{ id: "ca", name: "A1", unitIds: ["a"] }, { id: "cb", name: "A2", unitIds: ["a"] }];
  await assert.rejects(loadDreReportWithServices(input, actor(["a"]), db.services)); assert.equal(db.reads.length, 0);
});
