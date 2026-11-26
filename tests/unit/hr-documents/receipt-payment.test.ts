import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPayableReceipt, canResumePreparedReceiptPayment, receiptPartyDocumentHash, receiptPaymentSnapshot, receiptPixDestinationMatches } from "../../../src/features/hr/documents/receipt-payment";

const form = {
  receipt: {
    direction: "Pagamos",
    issuer: { snapshot: { document: "14.276.603/0001-25" } },
    recipient: { snapshot: { document: "123.456.789-10" } },
    items: [{ name: "A", value: 1000 }, { name: "B", value: 0.29 }],
    payment: { method: "pix", pixKey: "Financeiro@Example.COM" },
  },
};

test("captures raw numeric receipt value before document currency rendering", () => {
  const snapshot = receiptPaymentSnapshot(form);
  assert.equal(snapshot.amountCents, 100029);
  assertPayableReceipt(snapshot);
  assert.equal(receiptPixDestinationMatches(snapshot, "financeiro@example.com", "email"), true);
  assert.equal(receiptPixDestinationMatches(snapshot, "outro@example.com", "email"), false);
  assert.equal(JSON.stringify(snapshot).includes("Financeiro@"), false);
  assert.equal(snapshot.issuerDocumentHash, receiptPartyDocumentHash("14276603000125"));
  assert.notEqual(snapshot.recipientDocumentHash, receiptPartyDocumentHash("12345678010"));
});

test("rejects receipts that cannot be sent to the bank", () => {
  assert.throws(() => assertPayableReceipt(receiptPaymentSnapshot({ receipt: { ...form.receipt, direction: "Recebemos" } })), /saída/);
  assert.throws(() => assertPayableReceipt(receiptPaymentSnapshot({ receipt: { ...form.receipt, payment: { method: "cash" } } })), /Pix/);
  assert.throws(() => assertPayableReceipt(receiptPaymentSnapshot({ receipt: { ...form.receipt, items: [{ value: 0 }] } })), /positivo/);
});

test("resumes only a prepared request with no evidence of bank submission", () => {
  assert.equal(canResumePreparedReceiptPayment({ status: "ready_to_submit" }), true);
  assert.equal(canResumePreparedReceiptPayment({ status: "submitting" }), false);
  assert.equal(canResumePreparedReceiptPayment({ status: "failed" }), false);
  assert.equal(canResumePreparedReceiptPayment({ status: "ready_to_submit", submissionStartedAt: "2026-11-26" }), false);
  assert.equal(canResumePreparedReceiptPayment({ status: "ready_to_submit", interRequestId: "bank" }), false);
});
