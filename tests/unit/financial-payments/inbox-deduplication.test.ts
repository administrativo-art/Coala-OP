import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDuplicateChecksClear,
  expenseAndObligationDuplicateCheck,
  importedStatementDuplicateCheck,
  localRequestDuplicateCheck,
  sourceAndFingerprintDuplicateCheck,
} from "../../../src/features/financial/payment-requests/inbox-deduplication";

test("solicitação local ativa, paga ou com tentativa anterior bloqueia; rejeição limpa não bloqueia", () => {
  assert.equal(localRequestDuplicateCheck({
    currentRequestId: "current",
    requests: [{ id: "other", data: { status: "scheduled" } }],
  }).state, "duplicate");
  assert.equal(localRequestDuplicateCheck({
    currentRequestId: "current",
    requests: [{ id: "other", data: { status: "rejected" } }],
  }).state, "clear");
  assert.equal(localRequestDuplicateCheck({
    currentRequestId: "current",
    requests: [{ id: "other", data: { status: "failed", submissionStartedAt: "2026-10-21" } }],
  }).state, "duplicate");
  assert.equal(localRequestDuplicateCheck({
    currentRequestId: "replacement",
    requests: [{ id: "original", data: {
      status: "failed",
      submissionStartedAt: "2026-10-21",
      supersededByPaymentRequestId: "replacement",
    } }],
  }).state, "clear");
});

test("despesa, obrigação, pagamento e baixa parcial são tratados como duplicidade", () => {
  const open = { status: "pending", settlementSummary: { confirmedPrincipalAmountCents: 0 } };
  assert.equal(expenseAndObligationDuplicateCheck({ expense: open, obligation: null, payments: [], paymentLinks: [] }).state, "clear");
  assert.equal(expenseAndObligationDuplicateCheck({ expense: { ...open, status: "partially_paid" }, obligation: null, payments: [], paymentLinks: [] }).state, "duplicate");
  assert.equal(expenseAndObligationDuplicateCheck({ expense: open, obligation: null,
    payments: [{ status: "MATCHED", principalAmountCents: 1 }], paymentLinks: [] }).state, "duplicate");
  assert.equal(expenseAndObligationDuplicateCheck({ expense: open,
    obligation: { status: "PARTIALLY_PAID", summary: {} }, payments: [], paymentLinks: [] }).state, "duplicate");
});

test("hash ausente ou consulta truncada falham fechados e cópia exata bloqueia", () => {
  assert.equal(sourceAndFingerprintDuplicateCheck({ currentMessageId: "a", messages: [], rawSha256: null }).state, "unknown");
  assert.equal(sourceAndFingerprintDuplicateCheck({ currentMessageId: "a", messages: [
    { id: "a", data: {} }, { id: "b", data: {} },
  ], rawSha256: "hash" }).state, "duplicate");
  assert.throws(() => assertDuplicateChecksClear([{ state: "unknown", reason: "incompleta" }]), /incompleta/);
});

test("extrato reconhece boleto, CNPJ e fornecedor; débito sem identidade exige revisão", () => {
  const barcode = "1".repeat(47);
  assert.equal(importedStatementDuplicateCheck({ events: [{ bankStatementData: { detalhes: { codBarraLinhaDigitavel: barcode } } }], barcode }).state, "duplicate");
  assert.equal(importedStatementDuplicateCheck({ events: [{ description: "Pagamento BIZNEO" }], barcode,
    supplierName: "Bizneo" }).state, "duplicate");
  assert.equal(importedStatementDuplicateCheck({ events: [{ description: "Pagamento diverso" }], barcode }).state, "unknown");
  assert.equal(importedStatementDuplicateCheck({ events: [], barcode }).state, "clear");
});
