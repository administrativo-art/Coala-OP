import assert from "node:assert/strict";
import test from "node:test";

import { dreFlowUnavailable, evaluateDreFlow, type DreFlowUnitInput, type DreInput } from "../../src/features/financial/month-closing/dre-flow";

const unit = (patch: Partial<DreFlowUnitInput> = {}): DreFlowUnitInput => ({
  key: "u", label: "Tiririca", cmv: { status: "closed", complete: true, sourceChanged: false },
  revenueProven: true, cashProven: true, cashCoveredDays: 31, cashTotalDays: 31, ...patch,
});
const flow = (dre: DreInput, canViewItems = true) => evaluateDreFlow({ dre, canViewItems, originHref: "/dre?month=2026-10" });
const check = (result: ReturnType<typeof flow>, id: string) => result.checks.find((entry) => entry.id === id)!;

test("DRE fecha com CMV congelado, receita e caixa comprovados e despesas sem inconsistência", () => {
  const result = flow({ monthOver: true, units: [unit(), unit({ key: "v", label: "Matriz" })], expenseIssueCount: 0 });
  assert.equal(result.key, "dre");
  assert.equal(result.state, "ok");
  assert.equal(check(result, "dre.cmv").done, 2);
  assert.equal(result.items.length, 0);
});

test("antes de o mês terminar nada é dado como conferido", () => {
  const result = flow({ monthOver: false, units: [unit()], expenseIssueCount: 0 });
  assert.equal(result.state, "pending");
  assert.ok(result.checks.every((entry) => entry.state === "pending" && entry.done === null));
});

test("CMV em aberto, incompleto ou com venda alterada mantém o fluxo pendente, por unidade", () => {
  const result = flow({ monthOver: true, expenseIssueCount: 0, units: [
    unit({ key: "a", label: "A", cmv: { status: "open", complete: true, sourceChanged: false } }),
    unit({ key: "b", label: "B", cmv: { status: "closed", complete: false, sourceChanged: false } }),
    unit({ key: "c", label: "C", cmv: { status: "closed", complete: true, sourceChanged: true } }),
    unit({ key: "d", label: "D", cmv: null }),
    unit({ key: "e", label: "E" }),
  ] });
  assert.equal(result.state, "pending");
  assert.deepEqual(result.items.map((item) => item.kind), ["dre_cmv_open", "dre_cmv_incomplete", "dre_cmv_changed", "dre_cmv_open"]);
  assert.equal(check(result, "dre.cmv").done, 1);
  assert.equal(check(result, "dre.cmv").total, 5);
});

test("receita não comprovada ou caixa provisório não fecha, mesmo com CMV congelado", () => {
  const result = flow({ monthOver: true, expenseIssueCount: 0, units: [unit({ cashProven: false, cashCoveredDays: 20 }), unit({ key: "v", revenueProven: false })] });
  assert.equal(check(result, "dre.cmv").state, "ok");
  assert.equal(check(result, "dre.sources").state, "pending");
  assert.equal(check(result, "dre.sources").done, 0);
  assert.match(result.items[0].detail, /20 de 31 dias/);
  assert.match(result.items[1].detail, /receita do mês não está comprovada/);
});

test("despesas com inconsistência contábil seguram o fluxo e não expõem descrição", () => {
  const result = flow({ monthOver: true, units: [unit()], expenseIssueCount: 3 });
  assert.equal(check(result, "dre.expenses").state, "pending");
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].detail, /3 inconsistências contábeis impedem/);
});

test("sem unidade com receita ou sem fonte lida, nunca é conferido", () => {
  assert.equal(flow({ monthOver: true, units: [], expenseIssueCount: 0 }).state, "pending");
  assert.equal(flow(null).state, "unavailable");
  assert.equal(dreFlowUnavailable("/dre").checks.length, 3);
});

test("sem permissão os itens ficam ocultos", () => {
  const result = flow({ monthOver: true, units: [unit({ cmv: null })], expenseIssueCount: 0 }, false);
  assert.deepEqual(result.items, []);
  assert.equal(result.itemsHidden, true);
});
