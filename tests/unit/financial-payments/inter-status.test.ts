import assert from "node:assert/strict";
import test from "node:test";
import { safeInterPaymentError } from "../../../src/lib/integrations/inter/payment-error";
import { mapInterPixStatus, normalizeInterPixKey } from "../../../src/lib/integrations/inter/pix-payments.server";
import { paymentReceiverMatchesSnapshot } from "../../../src/features/financial/payment-requests/reconciliation";
import { createHash } from "node:crypto";

test("maps confirmed Inter statuses to paid", () => {
  for (const status of ["PROCESSADO", "PAGO", "EFETIVADO", "CONCLUIDO", "LIQUIDADO"]) {
    assert.equal(mapInterPixStatus(status), "paid");
  }
});

test("maps approval, rejection and expiration without inventing paid", () => {
  assert.equal(mapInterPixStatus("AGUARDANDO_APROVACAO"), "awaiting_bank_approval");
  assert.equal(mapInterPixStatus("REJEITADO"), "rejected");
  assert.equal(mapInterPixStatus("EXPIRADO"), "approval_expired");
  assert.equal(mapInterPixStatus("STATUS_NOVO_DO_BANCO"), "processing");
  assert.notEqual(mapInterPixStatus(undefined), "paid");
});

test("normaliza a chave Pix para o formato aceito pelo DICT", () => {
  assert.equal(normalizeInterPixKey("29.696.755/0001-54", "cnpj"), "29696755000154");
  assert.equal(normalizeInterPixKey(" Financeiro@Example.COM ", "email"), "financeiro@example.com");
  assert.equal(normalizeInterPixKey("(98) 99999-9999", "phone"), "+5598999999999");
});

test("preserva o motivo seguro do 422 sem revelar dados do favorecido", () => {
  const parsed = safeInterPaymentError({
    response: {
      status: 422,
      data: {
        detail: "Dados inválidos.",
        violacoes: [{
          propriedade: "destinatario.chave",
          razao: "A chave 29696755000154 de financeiro@clinica.com não foi encontrada.",
        }],
      },
    },
  }, "2026-08-21T13:00:00.000Z");

  assert.equal(parsed.code, "INTER_HTTP_422");
  assert.match(parsed.safeMessage, /destinatario\.chave/);
  assert.doesNotMatch(parsed.safeMessage, /29696755000154|financeiro@clinica\.com/);
});

test("concilia o CNPJ completo do banco com o hash do snapshot mascarado", () => {
  const receiverDocument = "14276603000125";
  assert.equal(paymentReceiverMatchesSnapshot({
    receiverDocument,
    snapshotDocument: "**.***.***/****-25",
    snapshotDocumentHash: createHash("sha256").update(receiverDocument).digest("hex"),
  }), true);
  assert.equal(paymentReceiverMatchesSnapshot({
    receiverDocument: "29696755000154",
    snapshotDocument: "**.***.***/****-25",
    snapshotDocumentHash: createHash("sha256").update(receiverDocument).digest("hex"),
  }), false);
});
