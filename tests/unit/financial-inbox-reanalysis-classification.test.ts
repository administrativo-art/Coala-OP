import assert from "node:assert/strict";
import test from "node:test";

import { classificationForFinancialInboxReanalysis } from "../../src/features/financial/inbox/reanalysis-classification";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const current = {
  documentType: "charge",
  financeLikely: true,
  marketingLikely: false,
  confidence: "high",
  supplierName: "OCEANOS INVESTIMENTOS IMOBILIARIOS LTDA",
  competence: "2026-09",
  dueDate: "2026-10-05",
  amountCents: 146798,
  barcode: "1".repeat(47),
  barcodeMasked: "11111••••11111",
  links: ["https://portal.totalbank.com.br/boleto/download?id=trusted"],
  billingIdentity: { supplierTaxId: "05695860000100", customerAccount: null, contractNumber: null, serviceType: null, serviceNumbers: [] },
} satisfies FinancialInboxClassification;

const reparsed = {
  ...current,
  confidence: "medium",
  supplierName: "Supplymidia",
  competence: null,
  barcode: null,
  barcodeMasked: null,
  billingIdentity: null,
  links: [],
} satisfies FinancialInboxClassification;

test("preserva a classificação já vinculada quando a nova extração por imagem é incompleta", () => {
  const result = classificationForFinancialInboxReanalysis({ status: "awaiting_authorization", current, reparsed });
  assert.equal(result.barcode, current.barcode);
  assert.equal(result.supplierName, current.supplierName);
  assert.equal(result.billingIdentity?.supplierTaxId, "05695860000100");
  assert.deepEqual(result.links, current.links);
});

test("atualiza a classificação enquanto a cobrança ainda está em análise", () => {
  const result = classificationForFinancialInboxReanalysis({ status: "pending_review", current, reparsed });
  assert.equal(result.barcode, null);
  assert.equal(result.supplierName, "Supplymidia");
  assert.deepEqual(result.links, current.links);
});
