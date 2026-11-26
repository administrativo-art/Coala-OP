import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canSendDocumentReceiptPayment, canViewDocumentReceiptPayment, documentReceiptPaymentAction } from "../../../src/features/financial/payment-requests/document-receipt-permissions";
import { parseRouteMethods } from "../../../scripts/check-security-contracts.mjs";

const source = readFileSync("src/app/api/documents/generated/[id]/payment/route.ts", "utf8");
const allowed = {
  isDefaultAdmin: false,
  permissions: {
    hr: { formalization: { documents: { view: true } } },
    financial: { view: true, paymentRequests: { view: true, create: true, authorize: true, submit: true } },
  },
} as Parameters<typeof canSendDocumentReceiptPayment>[0];

test("new receipt payment route exports only directly contracted methods", () => {
  assert.deepEqual(parseRouteMethods(source, "src/app/api/documents/generated/[id]/payment/route.ts"), [{ method: "GET", contracted: true }, { method: "POST", contracted: true }]);
});

test("payment action permits verified preparation resumption and blocks uncertain or accepted states", () => {
  assert.equal(documentReceiptPaymentAction(null).enabled, true);
  assert.equal(documentReceiptPaymentAction(null, false, false).enabled, false);
  assert.equal(documentReceiptPaymentAction("ready_to_submit", true, false).enabled, false);
  assert.deepEqual(documentReceiptPaymentAction("ready_to_submit", true), { enabled: true, label: "Retomar envio ao Inter" });
  assert.equal(documentReceiptPaymentAction("ready_to_submit", false).enabled, false);
  for (const status of ["submitting", "failed", "awaiting_bank_approval", "processing", "scheduled", "paid"]) {
    assert.equal(documentReceiptPaymentAction(status, true).enabled, false, status);
  }
});

test("document and each financial privilege are required by the route policy", () => {
  assert.equal(canSendDocumentReceiptPayment(allowed), true);
  assert.equal(canViewDocumentReceiptPayment(allowed), true);
  assert.equal(canSendDocumentReceiptPayment({ ...allowed, permissions: { ...allowed.permissions, hr: { formalization: { documents: { view: false } } } } } as typeof allowed), false);
  for (const key of ["view", "create", "authorize", "submit"] as const) {
    const paymentRequests = { ...allowed.permissions.financial.paymentRequests, [key]: false };
    assert.equal(canSendDocumentReceiptPayment({ ...allowed, permissions: { ...allowed.permissions, financial: { ...allowed.permissions.financial, paymentRequests } } }), false, key);
  }
  assert.equal(canSendDocumentReceiptPayment({ ...allowed, permissions: { ...allowed.permissions, financial: { ...allowed.permissions.financial, view: false } } }), false);
  assert.equal(canViewDocumentReceiptPayment({ ...allowed, permissions: { ...allowed.permissions, financial: { ...allowed.permissions.financial, paymentRequests: { ...allowed.permissions.financial.paymentRequests, view: false } } } }), false);
});
