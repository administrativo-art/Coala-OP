import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSalesReconciliationCashEvidence } from "../../src/features/financial/sales-reconciliation/cash-evidence";

test("evidência do caixa só fica pronta com todos os dias aprovados", () => {
  const incomplete = buildSalesReconciliationCashEvidence({
    year: 2026,
    month: 9,
    summary: { closureCount: 29, approvedCount: 29, pendingCount: 0 },
  });
  assert.equal(incomplete.expectedDayCount, 30);
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.coveragePercent, 96.67);

  const ready = buildSalesReconciliationCashEvidence({
    year: 2026,
    month: 9,
    summary: {
      closureCount: 30,
      approvedCount: 30,
      pendingCount: 0,
      partialCount: 0,
      syncErrorCount: 0,
      differenceTotalCents: -500,
      supplyTotalCents: 2_000,
      withdrawalTotalCents: 10_000,
      closureIds: ["closure-b", "closure-a"],
      depositBatchIds: ["batch-1", "batch-1"],
    },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.differenceTotalCents, -500);
  assert.deepEqual(ready.closureIds, ["closure-a", "closure-b"]);
  assert.deepEqual(ready.depositBatchIds, ["batch-1"]);
});

test("ausência do resumo permanece explícita", () => {
  const evidence = buildSalesReconciliationCashEvidence({ year: 2026, month: 8 });
  assert.equal(evidence.status, "missing");
  assert.equal(evidence.coveragePercent, 0);
});

test("serviço consulta resumo oficial e bloqueia fechamento físico incompleto", async () => {
  const [service, summaries, page] = await Promise.all([
    readFile(new URL("../../src/features/financial/sales-reconciliation/service.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/cash-closures/summaries.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/sales-reconciliation/components/sales-reconciliation-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(service, /cashClosureMonthlySummaries/);
  assert.match(service, /cashEvidence\.status !== "ready"/);
  assert.match(summaries, /closureIds/);
  assert.match(summaries, /depositBatchIds/);
  assert.match(page, /Evidências do caixa/);
  assert.match(page, /Abrir fechamentos/);
});
