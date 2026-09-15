import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const service = readFileSync("src/features/financial/sales-reconciliation/service.server.ts", "utf8");
const listRoute = readFileSync("src/app/api/financial/sales-reconciliation/route.ts", "utf8");
const importRoute = readFileSync("src/app/api/financial/sales-reconciliation/import/route.ts", "utf8");
const receivablesService = readFileSync("src/features/financial/stone-receivables/service.server.ts", "utf8");
const receivablesRoute = readFileSync("src/app/api/financial/stone-receivables/route.ts", "utf8");
const receivablesImportRoute = readFileSync("src/app/api/financial/stone-receivables/import/route.ts", "utf8");
const receivablesPage = readFileSync("src/features/financial/stone-receivables/components/stone-receivables-page.tsx", "utf8");
const cashFlowProjectionService = readFileSync("src/features/financial/cash-flow/projection.server.ts", "utf8");
const cashFlowProjectionRoute = readFileSync("src/app/api/financial/cash-flow/projection/route.ts", "utf8");
const cashFlowPage = readFileSync("src/features/financial/pages/cash-flow-page.tsx", "utf8");
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
    assert.match(receivablesRoute, /salesReconciliation\?\.view/);
    assert.match(receivablesImportRoute, /stoneIntegration\?\.manage/);
    assert.match(cashFlowProjectionRoute, /cashFlow\?\.view/);
    assert.match(cashFlowProjectionRoute, /canAccessUnit/);
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
    assert.match(receivablesService, /\.limit\(input\.limit \+ 1\)/);
    assert.match(receivablesService, /startAfter\(cursor\.date, cursor\.id\)/);
    assert.match(receivablesPage, /\/api\/financial\/stone-receivables/);
    assert.doesNotMatch(receivablesPage, /useFinancialCollection|getDocs\s*\(|onSnapshot\s*\(|setInterval\s*\(/);
    for (const limit of [
      "MAX_ACCOUNTS",
      "MAX_RECEIVABLES",
      "MAX_EXPENSES",
      "MAX_UNPROGRAMMED_EXPENSES",
      "MAX_PAYMENT_REQUESTS",
      "MAX_TRANSACTIONS",
    ]) assert.match(cashFlowProjectionService, new RegExp(`\\.limit\\(${limit} \\+ 1\\)`));
    assert.doesNotMatch(cashFlowProjectionService, /\bonSnapshot\s*\(|\bsetInterval\s*\(/);
    assert.match(cashFlowPage, /\/api\/financial\/cash-flow\/projection/);
    assert.match(cashFlowPage, /PageContainer variant="wide"/);
    assert.doesNotMatch(cashFlowPage, /useFinancialCollection|getDocs\s*\(|onSnapshot\s*\(|setInterval\s*\(/);
  });

  it("nega acesso direto e declara todos os índices usados pelas APIs", () => {
    for (const collection of [
      "stoneMerchantMappings",
      "pdvPaymentFacts",
      "stoneSaleTransactions",
      "stoneReceivables",
      "stoneSettlements",
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
      "stoneReceivables",
      "stoneSettlements",
      "salesReconciliationCases",
      "revenueReconciliationPeriods",
    ]) {
      assert.ok(collectionGroups.has(collection), `índice ausente para ${collection}`);
    }
  });
});
