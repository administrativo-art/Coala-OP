import assert from "node:assert/strict";
import test from "node:test";

import {
  compareFgtsPixReceiver,
  FGTS_DIGITAL_RECEIVER_DOCUMENT,
  inboxPixCopyPastePreparationSchema,
  mapInterPixSubmissionStatus,
  pixCopyPasteBeneficiary,
  planInboxPixCopyPastePreparation,
} from "../../../src/features/financial/payment-requests/inbox-pix-copy-paste";

const fgts = "00020101021226900014br.gov.bcb.pix2568pix-qrcode.caixa.gov.br/api/v2/cobv/7848581fcaea42e993a4208953e6c5cb5204000053039865802BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***6304DC8A";
const message = {
  id: "c93c9f96", workspaceId: "coala", status: "linked", linkedExpenseId: "inbox_c93c9f96",
  classification: { documentType: "fgts", amountCents: 378507, dueDate: "2026-11-19", competence: "2026-10", fiscalIdentity: { documentKind: "fgts" } },
};
const base = { message, workspaceId: "coala", scheduledFor: "2026-11-19", pixCopyPaste: fgts, today: "2026-11-06" };

test("prepara a guia FGTS com snapshot do Pix e data até o vencimento", () => {
  const plan = planInboxPixCopyPastePreparation(base);
  assert.equal(plan.amountCents, 378507);
  assert.equal(plan.expenseId, "inbox_c93c9f96");
  assert.equal(plan.snapshot.type, "pix_copy_paste");
  assert.equal(plan.snapshot.payload, fgts);
  assert.equal(plan.snapshot.dueDate, "2026-11-19");
  assert.equal(plan.snapshot.scheduledFor, "2026-11-19");
  assert.doesNotMatch(plan.snapshot.maskedPayload, /7848581fcaea/);
});

test("recusa documento que não é FGTS, sem vínculo, datas fora do prazo ou valor ausente", () => {
  const variants = [
    { ...base, message: { ...message, classification: { ...message.classification, documentType: "inss_darf" } } },
    { ...base, message: { ...message, classification: { ...message.classification, fiscalIdentity: { documentKind: "darf" } } } },
    { ...base, message: { ...message, linkedExpenseId: null } },
    { ...base, message: { ...message, workspaceId: "outro" } },
    { ...base, message: { ...message, existingSettlement: { transactionId: "tx" } } },
    { ...base, message: { ...message, existingBankPayment: { transactionId: "tx" } } },
    { ...base, scheduledFor: "2026-11-05" },
    { ...base, scheduledFor: "2026-11-20" },
    { ...base, message: { ...message, classification: { ...message.classification, amountCents: null } } },
    { ...base, pixCopyPaste: `${fgts.slice(0, -4)}0000` },
  ];
  for (const variant of variants) assert.throws(() => planInboxPixCopyPastePreparation(variant as typeof base));
});

test("entrada da rota exige data válida e payload completo, sem campos extras", () => {
  assert.equal(inboxPixCopyPastePreparationSchema.safeParse({ scheduledFor: "2026-11-19", pixCopyPaste: fgts }).success, true);
  assert.equal(inboxPixCopyPastePreparationSchema.safeParse({ scheduledFor: "2026-02-30", pixCopyPaste: fgts }).success, false);
  assert.equal(inboxPixCopyPastePreparationSchema.safeParse({ scheduledFor: "2026-11-19", pixCopyPaste: "curto" }).success, false);
  assert.equal(inboxPixCopyPastePreparationSchema.safeParse({ scheduledFor: "2026-11-19", pixCopyPaste: fgts, amount: 1 }).success, false);
});

test("destino do envio é PIX_COPIA_E_COLA da Caixa", () => {
  const beneficiary = pixCopyPasteBeneficiary(planInboxPixCopyPastePreparation(base).snapshot);
  assert.equal(beneficiary.paymentMethod, "pix_copy_paste");
  assert.equal(beneficiary.pixCopyPaste, fgts);
  assert.equal(beneficiary.document, FGTS_DIGITAL_RECEIVER_DOCUMENT);
});

test("só documento completo diferente da Caixa é divergência do recebedor", () => {
  assert.equal(compareFgtsPixReceiver("00.360.305/0001-04"), "matched");
  assert.equal(compareFgtsPixReceiver("***.360.305/0001-**"), "unavailable");
  assert.equal(compareFgtsPixReceiver(undefined), "unavailable");
  assert.equal(compareFgtsPixReceiver("11222333000181"), "divergent");
});

test("retorno do envio: aprovação, agendado ou processando", () => {
  assert.equal(mapInterPixSubmissionStatus({ returnType: "APROVACAO", paymentDate: "2026-11-19", today: "2026-11-06" }), "awaiting_bank_approval");
  assert.equal(mapInterPixSubmissionStatus({ returnType: "AGENDAMENTO", paymentDate: "2026-11-19", today: "2026-11-06" }), "scheduled");
  assert.equal(mapInterPixSubmissionStatus({ returnType: "PAGAMENTO", paymentDate: "2026-11-06", today: "2026-11-06" }), "processing");
});
