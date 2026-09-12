import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kpiFlowStripSource = readFileSync(
  "src/features/financial/components/expenses/kpi-flow-strip.tsx",
  "utf8",
);

test("faixa de KPIs preserva as medidas centrais do handoff", () => {
  assert.match(kpiFlowStripSource, /grid gap-\[14px\]/);
  assert.equal(
    [...kpiFlowStripSource.matchAll(/rounded-\[18px\]/g)].length,
    3,
  );
  assert.equal(
    [...kpiFlowStripSource.matchAll(/px-5 py-\[18px\]/g)].length,
    3,
  );
  assert.match(kpiFlowStripSource, /text-\[34px\] font-extrabold/);
  assert.match(kpiFlowStripSource, /h-\[9px\].*rounded-\[6px\].*bg-\[#eef0f2\]/);
  assert.match(kpiFlowStripSource, /mt-\[14px\].*gap-x-\[22px\]/);
});

test("faixa de KPIs usa a paleta do handoff nos três estágios", () => {
  for (const color of ["#e11d48", "#f59e0b", "#3b82f6", "#047857", "#8b5cf6", "#6d28d9"]) {
    assert.match(kpiFlowStripSource, new RegExp(color));
  }

  assert.match(kpiFlowStripSource, /A pagar no período/);
  assert.match(kpiFlowStripSource, /Pago no período/);
  assert.match(kpiFlowStripSource, /Pendente auditoria/);
});
