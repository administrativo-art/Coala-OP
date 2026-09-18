import assert from "node:assert/strict";
import test from "node:test";

import {
  financialDocumentIdentityFromClassification,
  mergeFinancialDocumentIdentities,
  paymentBarcodeHash,
} from "../../src/features/financial/inbox/document-identity";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

function classification(overrides: Partial<FinancialInboxClassification> = {}): FinancialInboxClassification {
  return {
    documentType: "charge",
    financeLikely: true,
    confidence: "high",
    supplierName: "Bizneo Solutions do Brasil Ltda",
    competence: "2026-09",
    dueDate: "2026-09-25",
    amountCents: 28560,
    barcode: "48190.00003 00005.150578 80058.150147 1 15800000028560",
    barcodeMasked: null,
    documentReferences: ["11328"],
    links: [],
    ...overrides,
  };
}

test("normaliza e cria uma identidade documental pesquisável", () => {
  const identity = financialDocumentIdentityFromClassification(classification(), "message-1");
  assert.equal(identity.barcode, "48190000030000515057880058150147115800000028560");
  assert.equal(identity.barcodeHash?.length, 64);
  assert.equal(identity.barcodeHash, paymentBarcodeHash(classification().barcode));
  assert.match(identity.barcodeMasked || "", /^48190.*28560$/);
  assert.deepEqual(identity.documentReferences, ["11328"]);
  assert.deepEqual(identity.sourceMessageIds, ["message-1"]);
});

test("agrega evidências sem sobrescrever um boleto divergente", () => {
  const current = financialDocumentIdentityFromClassification(classification(), "message-1");
  const incoming = financialDocumentIdentityFromClassification(classification({
    barcode: "34191.09081 46384.591148 03225.440001 4 15800000012654",
    documentReferences: ["11328", "285"],
  }), "message-2");
  const merged = mergeFinancialDocumentIdentities(current, incoming);
  assert.equal(merged.barcode, current.barcode);
  assert.deepEqual(merged.documentReferences, ["11328", "285"]);
  assert.deepEqual(merged.sourceMessageIds, ["message-1", "message-2"]);
  assert.deepEqual(merged.conflictFields, ["barcode"]);
});
