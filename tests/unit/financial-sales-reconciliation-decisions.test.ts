import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  revenueContributionByKiosk,
  revenueContributionDelta,
  reviewStatusForDecision,
} from "../../src/features/financial/sales-reconciliation/decision-effects";
import { salesReconciliationDecisionSchema } from "../../src/features/financial/sales-reconciliation/schemas";
import type { PersistedSalesReconciliationCase } from "../../src/features/financial/sales-reconciliation/types";

function reconciliationCase(
  overrides: Partial<PersistedSalesReconciliationCase> = {},
): PersistedSalesReconciliationCase {
  return {
    id: "case-1",
    identityId: "identity-1",
    projectionId: "projection-1",
    deterministicKey: "key-1",
    workspaceId: "coala",
    kioskId: "tirirical",
    kioskIds: ["tirirical"],
    period: "2026-09",
    businessDate: "2026-09-15",
    channel: "credit_card",
    pdvFactIds: ["pdv-1"],
    stoneSaleIds: ["stone-1"],
    pdvGrossAmountCents: 10_000,
    stoneGrossAmountCents: 10_000,
    differenceAmountCents: 0,
    kind: "matched",
    matchBasis: "provider_transaction_id",
    confidence: "high",
    sourceFingerprint: "fingerprint",
    suggestedReviewStatus: "matched_auto",
    reviewStatus: "matched_auto",
    ...overrides,
  };
}

describe("efeitos das decisões de conciliação de vendas", () => {
  it("contabiliza automaticamente apenas caso pareado na unidade", () => {
    const contribution = revenueContributionByKiosk({
      entry: reconciliationCase(),
      reviewStatus: "matched_auto",
    });
    assert.equal(contribution.get("tirirical"), 10_000);
  });

  it("não transforma pagamento PDV inválido em receita conciliada", () => {
    const contribution = revenueContributionByKiosk({
      entry: reconciliationCase({ kind: "pdv_only", stoneSaleIds: [], stoneGrossAmountCents: 0 }),
      reviewStatus: "resolved",
      decision: { action: "classify", classification: "invalid_pdv_payment", reason: "Comprovante inválido" },
    });
    assert.equal(contribution.size, 0);
  });

  it("inclui venda exclusiva Stone somente após classificação explícita", () => {
    const entry = reconciliationCase({
      kind: "stone_only",
      pdvFactIds: [],
      pdvGrossAmountCents: 0,
      stoneGrossAmountCents: 12_345,
      reviewStatus: "pending_review",
      suggestedReviewStatus: "pending_review",
    });
    const delta = revenueContributionDelta({
      entry,
      previousReviewStatus: "pending_review",
      nextReviewStatus: "resolved",
      nextDecision: { action: "classify", classification: "stone_only_sale", reason: "Venda comprovada na Stone" },
    });
    assert.equal(delta.get("tirirical"), 12_345);
  });

  it("move o efeito gerencial para a unidade escolhida sem alterar o consolidado", () => {
    const entry = reconciliationCase({
      kind: "unit_mismatch",
      kioskId: null,
      kioskIds: ["joao-paulo", "tirirical"],
      reviewStatus: "pending_review",
      suggestedReviewStatus: "pending_review",
    });
    const contribution = revenueContributionByKiosk({
      entry,
      reviewStatus: "resolved",
      decision: {
        action: "classify",
        classification: "wrong_unit",
        targetKioskId: "joao-paulo",
        reason: "Stonecode pertence a João Paulo",
      },
    });
    assert.deepEqual([...contribution], [["joao-paulo", 10_000]]);
  });

  it("diferencia resolução de item ignorado", () => {
    assert.equal(reviewStatusForDecision({ action: "confirm" }), "resolved");
    assert.equal(reviewStatusForDecision({ action: "ignore" }), "ignored");
  });

  it("exige unidade de destino somente na classificação compatível", () => {
    assert.equal(salesReconciliationDecisionSchema.safeParse({
      action: "classify",
      classification: "wrong_unit",
      reason: "Unidade divergente",
    }).success, false);
    assert.equal(salesReconciliationDecisionSchema.safeParse({
      action: "classify",
      classification: "wrong_unit",
      targetKioskId: "joao-paulo",
      reason: "Unidade divergente",
    }).success, true);
    assert.equal(salesReconciliationDecisionSchema.safeParse({
      action: "confirm",
      targetKioskId: "joao-paulo",
      reason: "Venda conferida",
    }).success, false);
  });
});
