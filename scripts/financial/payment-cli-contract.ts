import { PaymentCliError } from "./payment-cli-transport";

export type PaymentCliAction = "authorize" | "send";

export function validatePaymentCliAction(input: {
  request: Record<string, unknown>;
  action: PaymentCliAction;
  amountCents: number;
  scheduledFor: string;
  beneficiaryDocument: string;
  expenseId: string;
  barcode: string;
}) {
  const { request } = input;
  const barcode = request.barcodeSnapshot as Record<string, unknown> | undefined;
  const expectedStatus = input.action === "authorize" ? "awaiting_financial_authorization" : "ready_to_submit";
  const storedAmount = Number(request.amount);
  const date = new Date(`${input.scheduledFor}T12:00:00Z`);
  if (!["authorize", "send"].includes(input.action)
    || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || !Number.isFinite(storedAmount) || Math.round(storedAmount * 100) !== input.amountCents
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)
    || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.scheduledFor
    || !/^\d{11}(\d{3})?$/.test(input.beneficiaryDocument)
    || !/^(\d{44}|\d{46}|\d{47}|\d{48})$/.test(input.barcode)
    || !["financial_inbox", "expense_boleto"].includes(String(request.sourceType)) || request.paymentRail !== "barcode"
    || (request.sourceType === "expense_boleto" && request.sourceId !== input.expenseId)
    || typeof request.sourceId !== "string" || !request.sourceId
    || request.expenseId !== input.expenseId || !input.expenseId
    || typeof barcode?.code !== "string" || barcode.code !== input.barcode
    || barcode.scheduledFor !== input.scheduledFor
    || barcode.beneficiaryDocument !== input.beneficiaryDocument) {
    throw new PaymentCliError("Os dados da solicitação divergem da ordem específica. Nenhuma ação foi feita.");
  }
  if (request.interRequestId || request.submissionStartedAt || request.status !== expectedStatus) {
    throw new PaymentCliError("A solicitação não está em estado de primeira autorização ou primeiro envio. Nenhuma ação foi feita.");
  }
}
