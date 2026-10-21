import type { InterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";
import { interBarcodePaymentMatchesRequest } from "./barcode-amounts";

const INACTIVE_STATUSES = new Set(["REJEITADO", "RECUSADO", "CANCELADO"]);

export type BarcodeBankPreflightResult =
  | { kind: "clear" }
  | { kind: "recover"; payment: InterBarcodePayment; bankTransactionCode: string }
  | { kind: "blocked"; reason: string };

export function barcodeBankPreflight(params: {
  candidates: InterBarcodePayment[];
  requestedAmount: number;
  dueDate: string;
  scheduledFor: string;
  beneficiaryDocument?: string | null;
}): BarcodeBankPreflightResult {
  const active = params.candidates.filter((candidate) => (
    !INACTIVE_STATUSES.has(String(candidate.statusPagamento || "").toUpperCase())
  ));
  if (active.length > 1) {
    return { kind: "blocked", reason: "O Banco Inter retornou mais de um pagamento ativo para esta linha digitável. Confira no Internet Banking antes de continuar." };
  }
  const payment = active[0];
  if (!payment) return { kind: "clear" };
  if (!interBarcodePaymentMatchesRequest({
    payment,
    requestedAmount: params.requestedAmount,
    dueDate: params.dueDate,
    scheduledFor: params.scheduledFor,
  })) {
    return { kind: "blocked", reason: "O Banco Inter já possui pagamento para esta linha digitável com valores incompatíveis. Confira no Internet Banking antes de continuar." };
  }
  const requestBeneficiary = String(params.beneficiaryDocument ?? "").replace(/\D/g, "");
  const bankBeneficiary = String(payment.cpfCnpjBeneficiario ?? "").replace(/\D/g, "");
  if (requestBeneficiary && bankBeneficiary && requestBeneficiary !== bankBeneficiary) {
    return { kind: "blocked", reason: "O favorecido do pagamento encontrado no Inter diverge da cobrança. A recuperação foi bloqueada." };
  }
  const bankTransactionCode = String(payment.codigoTransacao ?? "").trim();
  if (!bankTransactionCode) {
    return { kind: "blocked", reason: "O Inter encontrou um pagamento para a linha digitável, mas não retornou um identificador recuperável." };
  }
  return { kind: "recover", payment, bankTransactionCode };
}
