import assert from "node:assert/strict";
import test from "node:test";

import {
  retentionFields,
  retentionNeedsEmploymentEndReconciliation,
} from "../../../src/features/hr/documents/document-retention";

test("mantém retenção trabalhista sem vencimento enquanto não há término", () => {
  const fields = retentionFields({
    policyId: "employment_plus_5y",
    generatedAt: "2026-07-28T00:00:00.000Z",
  });
  assert.equal(fields.retentionAnchorType, "employment_end");
  assert.equal(fields.retentionAnchorAt, null);
  assert.equal(fields.retentionUntil, null);
});

test("job de reconciliação identifica desligado com retenção nula", () => {
  assert.equal(
    retentionNeedsEmploymentEndReconciliation({
      employmentEndedAt: "2026-08-01T00:00:00.000Z",
      retentionAnchorType: "employment_end",
      retentionUntil: null,
    }),
    true,
  );
  assert.equal(
    retentionNeedsEmploymentEndReconciliation({
      employmentEndedAt: null,
      retentionAnchorType: "employment_end",
      retentionUntil: null,
    }),
    false,
  );
});
