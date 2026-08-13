import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashFlowCsv,
  buildExpenseLifecycleData,
} from "../../src/features/financial/lib/cash-flow-analysis";

test("comparativo contabiliza provisionado e pago por competência sem incluir rascunhos ou cancelados", () => {
  const data = buildExpenseLifecycleData([
    { status: "pending", totalValue: 1200, competenceDate: new Date(2026, 7, 1) },
    { status: "paid", totalValue: 400, competenceDate: new Date(2026, 7, 1) },
    { status: "draft", totalValue: 900, competenceDate: new Date(2026, 7, 1) },
    { status: "cancelled", totalValue: 800, competenceDate: new Date(2026, 7, 1) },
  ], 1, new Date(2026, 7, 13));

  assert.equal(data.length, 1);
  assert.equal(data[0].provisioned, 1600);
  assert.equal(data[0].paid, 400);
});

test("exportação CSV preserva detalhes contábeis e escapa descrições", () => {
  const csv = buildCashFlowCsv([{
    date: new Date(2026, 7, 13),
    description: 'Internet "Matriz"',
    supplier: "TVN",
    accountPlanName: "Tecnologia",
    accountName: "Banco Inter",
    competenceDate: new Date(2026, 7, 1),
    dueDate: new Date(2026, 7, 10),
    direction: "out",
    status: "forecast",
    amount: 101.32,
  }]);

  assert.match(csv, /^\ufeff/);
  assert.match(csv, /"Internet ""Matriz"""/);
  assert.match(csv, /"Tecnologia";"Banco Inter";"01\/08\/2026";"10\/08\/2026"/);
  assert.match(csv, /"Previsto";"Saída";"101,32"/);
});
