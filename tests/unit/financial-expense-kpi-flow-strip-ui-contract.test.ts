import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kpiFlowStripSource = readFileSync(
  "src/features/financial/components/expenses/kpi-flow-strip.tsx",
  "utf8",
);
const periodFilterSource = readFileSync(
  "src/features/financial/components/expenses/expense-period-filter.tsx",
  "utf8",
);

test("faixa de KPIs usa um único painel com três colunas", () => {
  assert.equal(
    [...kpiFlowStripSource.matchAll(/rounded-\[18px\]/g)].length,
    1,
  );
  assert.match(kpiFlowStripSource, /lg:grid-cols-\[minmax\(0,1\.45fr\)_minmax\(0,1\.15fr\)_minmax\(240px,\.78fr\)\]/);
  assert.match(kpiFlowStripSource, />Período<\/span>/);
  assert.equal([...kpiFlowStripSource.matchAll(/\{periodLabel\}/g)].length, 1);
  assert.match(kpiFlowStripSource, /text-\[30px\] font-extrabold/);
});

test("faixa de KPIs preserva hierarquia, paleta e composição financeira", () => {
  for (const token of ["bg-ds-danger", "bg-ds-warn", "bg-ds-info", "text-ds-warn", "bg-ds-warn-bg"]) {
    assert.match(kpiFlowStripSource, new RegExp(token));
  }
  assert.doesNotMatch(kpiFlowStripSource, /#[0-9a-fA-F]{6}/, "a faixa usa tokens do design, sem hex solto");

  assert.match(kpiFlowStripSource, /A pagar no período/);
  assert.match(kpiFlowStripSource, /Total do período/);
  assert.match(kpiFlowStripSource, /const periodTotal = kpis\.paid \+ kpis\.open/);
  assert.match(kpiFlowStripSource, /formatCurrency\(periodTotal\)/);
  for (const label of ["Pago", "Lançamentos a pagar", "Provisões conc. a pagar", "Em auditoria"]) {
    assert.match(kpiFlowStripSource, new RegExp(label));
  }
  assert.match(kpiFlowStripSource, /Pendente auditoria/);
  assert.match(kpiFlowStripSource, /periodLabel/);
  assert.match(kpiFlowStripSource, /aria-pressed=\{auditActive\}/);
});

test("filtro de vencimento permite selecionar o mês inteiro pelo título", () => {
  assert.match(periodFilterSource, /function selectEntireMonth\(month: Date\)/);
  assert.match(periodFilterSource, /from: startOfMonth\(month\), to: endOfMonth\(month\)/);
  assert.match(periodFilterSource, /CaptionLabel:/);
  assert.match(periodFilterSource, /title="Selecionar o mês inteiro"/);
});
