import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const service = readFileSync("src/features/financial/sales-reconciliation/service.server.ts", "utf8");
const listRoute = readFileSync("src/app/api/financial/sales-reconciliation/route.ts", "utf8");
const importRoute = readFileSync("src/app/api/financial/sales-reconciliation/import/route.ts", "utf8");
const decisionRoute = readFileSync(
  "src/app/api/financial/sales-reconciliation/cases/[caseId]/decision/route.ts",
  "utf8",
);
const closeRoute = readFileSync(
  "src/app/api/financial/sales-reconciliation/periods/[periodId]/close/route.ts",
  "utf8",
);
const reopenRoute = readFileSync(
  "src/app/api/financial/sales-reconciliation/periods/[periodId]/reopen/route.ts",
  "utf8",
);
const rules = readFileSync("firestore.financial.rules", "utf8");
const indexes = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
  indexes?: Array<{ collectionGroup?: string }>;
};

describe("política de armazenamento da conciliação de vendas", () => {
  it("mantém ingestão e listagem limitadas e paginadas no servidor", () => {
    assert.match(service, /MAX_MAPPINGS = 100/);
    assert.match(service, /MAX_FACTS_PER_SOURCE_PERIOD = 5_000/);
    assert.match(service, /\.limit\(MAX_MAPPINGS \+ 1\)/);
    assert.match(service, /\.limit\(MAX_FACTS_PER_SOURCE_PERIOD \+ 1\)/);
    assert.match(service, /\.limit\(input\.limit \+ 1\)/);
    assert.match(service, /startAfter\(input\.cursor\)/);
  });

  it("protege as rotas com autenticação e permissões segregadas", () => {
    assert.match(listRoute, /withApiErrorHandling/);
    assert.match(listRoute, /salesReconciliation\?\.view/);
    assert.match(listRoute, /canAccessUnit/);
    assert.match(importRoute, /withApiErrorHandling/);
    assert.match(importRoute, /stoneIntegration\?\.manage/);
    assert.match(importRoute, /canAccessKiosk/);
    assert.match(decisionRoute, /salesReconciliationDecisionSchema/);
    assert.match(decisionRoute, /permissions\?\.review/);
    assert.match(decisionRoute, /permissions\.classify/);
    assert.match(closeRoute, /salesReconciliation\?\.close/);
    assert.match(reopenRoute, /salesReconciliation\?\.reopen/);
  });

  it("atualiza decisão, auditoria e resumo dentro da mesma transação", () => {
    assert.match(service, /decideSalesReconciliationCase/);
    assert.match(service, /runTransaction/);
    assert.match(service, /salesReconciliationDecisions/);
    assert.match(service, /revenueMonthlySummaries/);
    assert.match(service, /collection\("events"\)/);
    assert.match(service, /buildingProjectionId/);
  });

  it("nega acesso direto e declara todos os índices usados pelas APIs", () => {
    for (const collection of [
      "stoneMerchantMappings",
      "pdvPaymentFacts",
      "stoneSaleTransactions",
      "stoneIngestionRuns",
      "salesReconciliationCases",
      "salesReconciliationDecisions",
      "revenueReconciliationPeriods",
      "revenueMonthlySummaries",
    ]) {
      assert.match(rules, new RegExp(`match /${collection}`));
    }
    const collectionGroups = new Set(indexes.indexes?.map((index) => index.collectionGroup));
    for (const collection of [
      "stoneMerchantMappings",
      "pdvPaymentFacts",
      "stoneSaleTransactions",
      "salesReconciliationCases",
      "revenueReconciliationPeriods",
    ]) {
      assert.ok(collectionGroups.has(collection), `índice ausente para ${collection}`);
    }
  });
});
