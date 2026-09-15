import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cashDifferenceEffects } from "../../src/features/financial/cash-differences/types";

test("falta confirmada vira despesa sem reduzir receita", () => {
  assert.deepEqual(cashDifferenceEffects({ differenceAmountCents: -1_250, classification: "operational_loss" }), {
    revenueAdjustmentCents: 0,
    expenseAmountCents: 1_250,
  });
  assert.throws(() => cashDifferenceEffects({ differenceAmountCents: 1_250, classification: "operational_loss" }), /falta de caixa/);
});

test("sobra só aumenta receita quando classificada como venda não registrada", () => {
  assert.deepEqual(cashDifferenceEffects({ differenceAmountCents: 2_000, classification: "unrecorded_sale" }), {
    revenueAdjustmentCents: 2_000,
    expenseAmountCents: 0,
  });
  assert.deepEqual(cashDifferenceEffects({ differenceAmountCents: 2_000, classification: "counting_error" }), {
    revenueAdjustmentCents: 0,
    expenseAmountCents: 0,
  });
});

test("decisão é transacional, auditada e não cria obrigação bancária", async () => {
  const [service, route, rules, page] = await Promise.all([
    readFile(new URL("../../src/features/financial/cash-differences/service.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/api/financial/cash-differences/[closureId]/decision/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../firestore.financial.rules", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/cash-differences/components/cash-differences-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(service, /runTransaction/);
  assert.match(service, /createsBankingObligation: false/);
  assert.match(service, /cashEffectAlreadyRealized: true/);
  assert.match(service, /collection\("events"\)/);
  assert.doesNotMatch(service, /financialObligations|obligationPaymentLinks/);
  assert.match(route, /salesReconciliation\?\.classify/);
  assert.match(rules, /cashClosureDifferenceDecisions/);
  assert.match(page, /Abrir origem/);
});
