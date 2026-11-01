import { normalizePaymentBarcode } from "@/features/financial/inbox/parser";
import { mapInterBarcodeStatus, type InterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";

export type ExternalInterAdoptionInput = {
  interRequestId: string;
  targetExpenseId: string;
  barcode: string;
  amountCents: number;
  scheduledFor: string;
  beneficiaryDocument: string;
};

export function validateExternalInterPayment(input: ExternalInterAdoptionInput, bank: InterBarcodePayment | null) {
  if (!bank || bank.codigoTransacao !== input.interRequestId) throw new Error("transaction");
  const code = normalizePaymentBarcode(String(bank.codigoBarra ?? ""));
  const beneficiaryDocument = String(bank.cpfCnpjBeneficiario ?? "").replace(/\D/g, "");
  const dueDate = String(bank.dataVencimentoDigitada || bank.dataVencimentoTitulo || "").slice(0, 10);
  const scheduledFor = String(bank.dataPagamento || "").slice(0, 10);
  const amountCents = Math.round(Number(bank.valorNominal ?? bank.valorPago) * 100);
  const settlementAmountCents = Math.round(Number(bank.valorPago ?? bank.valorNominal) * 100);
  if (!code || code !== normalizePaymentBarcode(input.barcode)
    || beneficiaryDocument !== input.beneficiaryDocument.replace(/\D/g, "")
    || scheduledFor !== input.scheduledFor || amountCents !== input.amountCents
    || settlementAmountCents < amountCents
    || (settlementAmountCents !== amountCents && scheduledFor <= dueDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("snapshot");
  const rawStatus = String(bank.statusPagamento ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!["AGENDADO", "PAGO", "EFETIVADO", "PROCESSADO", "CONCLUIDO", "LIQUIDADO", "REALIZADO"].includes(rawStatus)) {
    throw new Error("status");
  }
  const status = mapInterBarcodeStatus(bank.statusPagamento, scheduledFor);
  if (status !== "scheduled" && status !== "paid") throw new Error("status");
  return { code, beneficiaryDocument, dueDate, scheduledFor, amountCents, settlementAmountCents, status };
}
