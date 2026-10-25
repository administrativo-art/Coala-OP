import assert from "node:assert/strict";
import test from "node:test";

import { classificationWithPaymentSnapshot } from "../../src/features/financial/inbox/payment-snapshot";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const classification = {
  documentType: "charge",
  financeLikely: true,
  confidence: "medium",
  supplierName: "Bizneo",
  competence: null,
  dueDate: null,
  amountCents: null,
  barcode: null,
  barcodeMasked: null,
  links: [],
  billingIdentity: null,
} satisfies FinancialInboxClassification;

test("preenche evidência ausente com o snapshot que passou pela preparação bancária", () => {
  const result = classificationWithPaymentSnapshot(classification, {
    amount: 536.64,
    barcodeSnapshot: {
      code: "8".repeat(48),
      maskedCode: "88888••••88888",
      dueDate: "2026-10-26",
      beneficiaryDocument: "11.222.333/0001-81",
    },
  });
  assert.equal(result.amountCents, 53664);
  assert.equal(result.dueDate, "2026-10-26");
  assert.equal(result.barcode, "8".repeat(48));
  assert.equal(result.billingIdentity?.supplierTaxId, "11222333000181");
});

test("não sobrescreve correção já confirmada no inbox", () => {
  const corrected = {
    ...classification,
    amountCents: 28560,
    dueDate: "2026-10-20",
    barcode: "7".repeat(47),
    billingIdentity: {
      supplierTaxId: "99888777000166",
      customerAccount: null,
      contractNumber: null,
      serviceType: null,
      serviceNumbers: [],
    },
  } satisfies FinancialInboxClassification;
  const result = classificationWithPaymentSnapshot(corrected, {
    amount: 536.64,
    barcodeSnapshot: {
      code: "8".repeat(48),
      maskedCode: "88888••••88888",
      dueDate: "2026-10-26",
      beneficiaryDocument: "11222333000181",
    },
  });
  assert.equal(result.amountCents, 28560);
  assert.equal(result.dueDate, "2026-10-20");
  assert.equal(result.barcode, "7".repeat(47));
  assert.equal(result.billingIdentity?.supplierTaxId, "99888777000166");
});
