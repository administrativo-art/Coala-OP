import assert from "node:assert/strict";
import test from "node:test";
import { barcodeBankPreflight } from "../../../src/features/financial/payment-requests/barcode-bank-preflight";

const request = {
  requestedAmount: 285.6,
  dueDate: "2026-10-26",
  scheduledFor: "2026-10-26",
  beneficiaryDocument: "46.164.085/0001-44",
};

test("preflight bancário ignora rejeições anteriores e declara ausência sem inventar envio", () => {
  assert.deepEqual(barcodeBankPreflight({
    ...request,
    candidates: [{ codigoTransacao: "old", statusPagamento: "REJEITADO", valorNominal: 285.6 }],
  }), { kind: "clear" });
});

test("preflight recupera somente uma transação compatível", () => {
  const payment = {
    codigoTransacao: "inter-123",
    statusPagamento: "AGUARDANDO_APROVACAO",
    valorNominal: 285.6,
    cpfCnpjBeneficiario: "46164085000144",
  };
  assert.deepEqual(barcodeBankPreflight({ ...request, candidates: [payment] }), {
    kind: "recover",
    payment,
    bankTransactionCode: "inter-123",
  });
});

test("preflight bloqueia ambiguidade, valor, favorecido e identificador ausente", () => {
  assert.equal(barcodeBankPreflight({
    ...request,
    candidates: [
      { codigoTransacao: "a", statusPagamento: "AGENDADO", valorNominal: 285.6 },
      { codigoTransacao: "b", statusPagamento: "PAGO", valorNominal: 285.6 },
    ],
  }).kind, "blocked");
  assert.equal(barcodeBankPreflight({
    ...request,
    candidates: [{ codigoTransacao: "a", statusPagamento: "AGENDADO", valorNominal: 300 }],
  }).kind, "blocked");
  assert.equal(barcodeBankPreflight({
    ...request,
    candidates: [{ codigoTransacao: "a", statusPagamento: "AGENDADO", valorNominal: 285.6, cpfCnpjBeneficiario: "00000000000100" }],
  }).kind, "blocked");
  assert.equal(barcodeBankPreflight({
    ...request,
    candidates: [{ statusPagamento: "AGENDADO", valorNominal: 285.6, cpfCnpjBeneficiario: "46164085000144" }],
  }).kind, "blocked");
});
