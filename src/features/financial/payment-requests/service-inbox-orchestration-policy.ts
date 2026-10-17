import type { FinancialInboxMessage } from "@/features/financial/inbox/types";
import {
  FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT,
  FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS,
} from "./service-approval-policy";

export class FinancialServiceInboxPreparationIneligibleError extends Error {}

export type FinancialServiceInboxPreparationPlan = {
  kind: "already_linked" | "existing_expense" | "provision";
  barcode: string;
  dueDate: string;
  amountCents: number;
  expenseId?: string;
  installmentNumber?: number | null;
};

function digits(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function ineligible(reason: string): never {
  throw new FinancialServiceInboxPreparationIneligibleError(reason);
}

export function planFinancialServiceInboxPreparation(input: {
  message: FinancialInboxMessage;
  sourceId: string;
  allowedSourceIds: ReadonlySet<string>;
  workspaceId: string;
  today: string;
}): FinancialServiceInboxPreparationPlan {
  const { message } = input;
  if (!input.allowedSourceIds.has(input.sourceId)) ineligible("cobrança fora da autorização explícita");
  if (message.id !== input.sourceId || message.workspaceId !== input.workspaceId) ineligible("cobrança não encontrada no workspace");
  if (!message.classification.financeLikely || message.classification.marketingLikely) ineligible("documento não classificado como cobrança financeira");
  if (message.existingSettlement?.transactionId || message.existingBankPayment?.transactionId) ineligible("pagamento ou liquidação já encontrado");
  if (message.resolution?.status === "identified" && !message.linkedExpenseId) ineligible("mensagem já identificada como lembrete ou duplicidade");

  const amountCents = Number(message.classification.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS) {
    ineligible("valor fora do limite de R$ 5.000");
  }
  const supplierTaxId = digits(message.classification.billingIdentity?.supplierTaxId);
  if (supplierTaxId !== FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT) ineligible("CNPJ da cobrança não pertence à Vivo autorizada");
  const barcode = digits(message.classification.barcode);
  if (![44, 46, 47, 48].includes(barcode.length)) ineligible("linha digitável inválida");
  const dueDate = String(message.classification.dueDate ?? "");
  if (!validIsoDate(dueDate)) ineligible("vencimento inválido");
  if (dueDate < input.today) ineligible("cobrança vencida exige revisão do valor de liquidação");

  const shared = { barcode, dueDate, amountCents };
  if (message.linkedExpenseId) return { kind: "already_linked", expenseId: message.linkedExpenseId, ...shared };

  const existing = message.existingExpenseSuggestion;
  if (existing?.status === "suggested"
    && existing.expenseId
    && existing.paymentState === "needs_scheduling"
    && !existing.existingBankPayment
    && !existing.existingSettlement) {
    return {
      kind: "existing_expense",
      expenseId: existing.expenseId,
      installmentNumber: existing.installmentNumber,
      ...shared,
    };
  }

  const provision = message.provisionSuggestion;
  if (provision?.status === "suggested" && provision.provisionExpenseId) {
    return { kind: "provision", ...shared };
  }
  if (message.creationSuggestion?.status === "suggested") {
    ineligible("nenhuma despesa ou previsão única foi encontrada; a classificação contábil exige revisão");
  }
  ineligible("nenhuma despesa ou previsão única pôde ser vinculada");
}
