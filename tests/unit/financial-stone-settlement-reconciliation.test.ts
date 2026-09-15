import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertStoneSettlementLink,
  StoneSettlementReconciliationError,
  type StoneSettlementReconciliationCode,
} from "../../src/features/financial/stone-receivables/settlement-reconciliation";

const valid = {
  workspaceId: "coala",
  settlementWorkspaceId: "coala",
  transactionWorkspaceId: "coala",
  settlementAccountId: "stone",
  transactionAccountId: "stone",
  settlementAmountCents: 9_800,
  transactionAmountCents: 9_800,
  settlementDate: "2026-09-15",
  transactionDate: "2026-09-18",
  transactionDirection: "in",
  transactionReversed: false,
};

function rejects(code: StoneSettlementReconciliationCode, overrides: Partial<typeof valid>) {
  assert.throws(
    () => assertStoneSettlementLink({ ...valid, ...overrides }),
    (error) => error instanceof StoneSettlementReconciliationError && error.code === code,
  );
}

describe("vínculo da liquidação Stone ao livro bancário canônico", () => {
  it("aceita mesma conta, valor exato, entrada e janela de até três dias", () => {
    assert.doesNotThrow(() => assertStoneSettlementLink(valid));
  });

  it("rejeita workspace, conta, valor, direção, estorno e data incompatíveis", () => {
    rejects("WORKSPACE_MISMATCH", { transactionWorkspaceId: "outro" });
    rejects("ACCOUNT_MISMATCH", { transactionAccountId: "inter" });
    rejects("AMOUNT_MISMATCH", { transactionAmountCents: 9_799 });
    rejects("TRANSACTION_NOT_INCOMING", { transactionDirection: "out" });
    rejects("TRANSACTION_REVERSED", { transactionReversed: true });
    rejects("DATE_MISMATCH", { transactionDate: "2026-09-19" });
  });
});
