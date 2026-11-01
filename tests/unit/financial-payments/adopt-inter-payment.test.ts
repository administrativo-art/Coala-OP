import assert from "node:assert/strict";
import test from "node:test";

import { validateExternalInterPayment } from "../../../src/features/financial/payment-requests/adopt-inter-payment";

const input = {
  interRequestId: "af3cca34-dcf2-4d16-b5a7-bc23f695b46c",
  targetExpenseId: "cesar-thimotheo-acordo-2026-parcela-08",
  barcode: "46196163100001200001110000000000043035730501",
  amountCents: 120000,
  scheduledFor: "2026-11-16",
  beneficiaryDocument: "23623057000142",
};
const bank = {
  codigoTransacao: input.interRequestId,
  codigoBarra: input.barcode,
  dataVencimentoTitulo: "2026-11-15",
  dataPagamento: input.scheduledFor,
  valorNominal: 1200,
  valorPago: 1200,
  cpfCnpjBeneficiario: input.beneficiaryDocument,
  statusPagamento: "AGENDADO",
};

test("adota somente o agendamento bancário cujo identificador e dados conferem", () => {
  assert.deepEqual(validateExternalInterPayment(input, bank), {
    code: input.barcode, beneficiaryDocument: input.beneficiaryDocument,
    dueDate: "2026-11-15", scheduledFor: "2026-11-16", amountCents: 120000, settlementAmountCents: 120000, status: "scheduled",
  });
  for (const altered of [
    { codigoTransacao: "outro" }, { codigoBarra: "23791163200000536640460090000000466600193320" },
    { valorNominal: 1201 }, { cpfCnpjBeneficiario: "00000000000000" },
    { dataPagamento: "2026-11-17" }, { statusPagamento: "CANCELADO" },
  ]) assert.throws(() => validateExternalInterPayment(input, { ...bank, ...altered }));
});
