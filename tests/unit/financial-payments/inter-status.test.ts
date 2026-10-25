import assert from "node:assert/strict";
import test from "node:test";
import { safeInterPaymentError } from "../../../src/lib/integrations/inter/payment-error";
import { mapInterPixStatus, normalizeInterPixKey } from "../../../src/lib/integrations/inter/pix-payments.server";
import {
  comparePaymentReceiverToSnapshot,
  findExactPixReceiverDocument,
  paymentReceiverMatchesSnapshot,
} from "../../../src/features/financial/payment-requests/reconciliation";
import { InterApiError, safeInterApiError } from "../../../src/lib/integrations/inter/error";
import { createHash } from "node:crypto";
import { mapInterBarcodeStatus } from "../../../src/lib/integrations/inter/barcode-payments.server";

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

test("mantém Pix futuro como agendado até a confirmação bancária", () => {
  assert.equal(mapInterPixStatus("AGENDADO", "2099-09-03"), "scheduled");
  assert.equal(mapInterPixStatus("EM_PROCESSAMENTO", "2099-09-03"), "scheduled");
  assert.equal(mapInterPixStatus("PAGO", "2099-09-03"), "paid");
});

test("separa boleto agendado, aprovação bancária e pagamento efetivado", () => {
  assert.equal(mapInterBarcodeStatus("AGENDADO", "2026-08-25"), "scheduled");
  assert.equal(mapInterBarcodeStatus("AGUARDANDO_APROVACAO", "2026-08-25"), "awaiting_bank_approval");
  assert.equal(mapInterBarcodeStatus("PAGO", "2026-08-25"), "paid");
  assert.equal(mapInterBarcodeStatus("REALIZADO", "2026-08-25"), "paid");
  assert.equal(mapInterBarcodeStatus("EMPROCESSAMENTO", null), "processing");
});

test("normaliza a chave Pix para o formato aceito pelo DICT", () => {
  assert.equal(normalizeInterPixKey("29.696.755/0001-54", "cnpj"), "29696755000154");
  assert.equal(normalizeInterPixKey(" Financeiro@Example.COM ", "email"), "financeiro@example.com");
  assert.equal(normalizeInterPixKey("(98) 99999-9999", "phone"), "+5598999999999");
});

test("preserva o motivo sanitizado do corpo do erro 422", () => {
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
  assert.equal(
    parsed.safeMessage,
    "O Banco Inter recusou os dados do pagamento. Revise os dados antes de tentar novamente.",
  );
  assert.match(parsed.details ?? "", /Dados inválidos/);
  assert.match(parsed.details ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(parsed.safeMessage, /destinatario\.chave|29696755000154|financeiro@clinica\.com/);
  assert.doesNotMatch(parsed.details ?? "", /29696755000154|financeiro@clinica\.com/);
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

test("documento mascarado pelo status do Pix fica pendente e nunca vira divergência", () => {
  const snapshotDocumentHash = createHash("sha256").update("61261029321").digest("hex");
  assert.equal(comparePaymentReceiverToSnapshot({
    receiverDocument: "***610293**",
    snapshotDocument: "***.***.***-21",
    snapshotDocumentHash,
  }), "unavailable");
  assert.equal(paymentReceiverMatchesSnapshot({
    receiverDocument: "***610293**",
    snapshotDocument: "***.***.***-21",
    snapshotDocumentHash,
  }), true);
  assert.equal(comparePaymentReceiverToSnapshot({
    receiverDocument: "10987654321",
    snapshotDocument: "***.***.***-21",
    snapshotDocumentHash,
  }), "divergent");
});

test("extrato completo resolve o recebedor somente por referência, valor e débito Pix exatos", () => {
  const entry = {
    references: ["request-1", "e2e-1"],
    amount: -285.60,
    operationType: "D",
    transactionType: "PIX",
    raw: { detalhes: { cpfCnpjRecebedor: "61.261.029/321" } },
  };
  assert.equal(findExactPixReceiverDocument([entry], {
    interRequestId: "request-1",
    endToEndId: "e2e-1",
    amount: 285.60,
  }), "61261029321");
  assert.equal(findExactPixReceiverDocument([{ ...entry, amount: -285.61 }], {
    interRequestId: "request-1",
    endToEndId: "e2e-1",
    amount: 285.60,
  }), null);
  assert.equal(findExactPixReceiverDocument([entry, {
    ...entry,
    raw: { detalhes: { cpfCnpjRecebedor: "10.987.654/321" } },
  }], {
    interRequestId: "request-1",
    amount: 285.60,
  }), null);
});

test("recusa HTTP 400 do cliente Inter recebe mensagem segura e acionável", () => {
  const parsed = safeInterPaymentError(new InterApiError({
    code: "INTER_HTTP_400",
    operation: "api-request",
    statusCode: 400,
  }), "2026-10-22T12:00:00.000Z");
  assert.deepEqual(parsed, {
    code: "INTER_HTTP_400",
    safeMessage: "O Banco Inter recusou os dados do pagamento. Revise os dados antes de tentar novamente.",
    occurredAt: "2026-10-22T12:00:00.000Z",
  });
});

test("cliente Inter preserva apenas a categoria segura do campo recusado", () => {
  const parsed = safeInterApiError({
    isAxiosError: true,
    response: {
      status: 400,
      data: {
        violacoes: [{
          propriedade: "codBarraLinhaDigitavel",
          razao: "Linha 48190000030000515058653993860146216110000028560 inválida.",
        }],
      },
    },
  }, "api-request");
  assert.equal(parsed.safeMessage, "O Banco Inter recusou a linha digitável do boleto.");
  assert.doesNotMatch(parsed.safeMessage, /48190000030000515058653993860146216110000028560/);
});
