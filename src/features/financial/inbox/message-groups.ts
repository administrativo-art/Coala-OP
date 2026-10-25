import type { FinancialInboxMessage } from "./types";

export type FinancialInboxMessageGroup = {
  id: string;
  primary: FinancialInboxMessage;
  messages: FinancialInboxMessage[];
  messageCount: number;
};

function installmentKey(message: FinancialInboxMessage) {
  return message.resolution?.installmentNumber
    ?? message.linkedExpenseInstallmentNumber
    ?? message.classification.installmentNumber
    ?? message.existingExpenseSuggestion?.installmentNumber
    ?? "whole";
}

/**
 * A cobrança é uma unidade financeira, não uma conversa de e-mail.
 * Identidades financeiras explícitas prevalecem; a conversa só é usada como
 * fallback. Fornecedor, valor ou datas isolados nunca agrupam mensagens.
 */
export function financialInboxChargeGroupKey(message: FinancialInboxMessage) {
  const installment = installmentKey(message);
  // A linha digitável identifica o boleto de forma mais precisa que um
  // obligationId legado. Se duas mensagens chegaram a gerar obrigações
  // diferentes, ainda assim devem aparecer como uma única cobrança.
  const barcode = message.classification.barcode?.replace(/\D/g, "");
  if (barcode && (barcode.length === 44 || barcode.length === 46 || barcode.length === 47 || barcode.length === 48)) {
    return `barcode:${barcode}`;
  }
  if (message.obligationId) return `obligation:${message.obligationId}:${installment}`;
  if (message.paymentRequestId) return `payment-request:${message.paymentRequestId}:${installment}`;
  if (message.linkedExpenseId) return `expense:${message.linkedExpenseId}:${installment}`;
  if (message.resolution?.targetType === "expense" && message.resolution.targetId) {
    return `expense:${message.resolution.targetId}:${installment}`;
  }
  if (message.thread?.primaryMessageId) return `thread:${message.thread.primaryMessageId}`;
  return `message:${message.id}`;
}

function primaryScore(message: FinancialInboxMessage) {
  if (message.resolution?.kind === "new_charge") return 3;
  if (message.linkedExpenseId) return 2;
  if (message.resolution?.kind !== "reminder" && message.resolution?.kind !== "duplicate") return 1;
  return 0;
}

export function groupFinancialInboxMessages(messages: FinancialInboxMessage[]): FinancialInboxMessageGroup[] {
  const groups = new Map<string, FinancialInboxMessage[]>();
  messages.forEach((message) => {
    const key = financialInboxChargeGroupKey(message);
    groups.set(key, [...(groups.get(key) ?? []), message]);
  });
  return [...groups.entries()].map(([id, entries]) => {
    const sorted = [...entries].sort((left, right) => (
      primaryScore(right) - primaryScore(left)
      || left.receivedAt.localeCompare(right.receivedAt)
      || left.id.localeCompare(right.id)
    ));
    return {
      id,
      primary: sorted[0],
      messages: [...entries].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)),
      messageCount: id.startsWith("thread:")
        ? Math.max(entries.length, ...entries.map((entry) => entry.thread?.messageCount ?? 0))
        : entries.length,
    };
  }).sort((left, right) => (
    right.messages.at(-1)!.receivedAt.localeCompare(left.messages.at(-1)!.receivedAt)
    || left.id.localeCompare(right.id)
  ));
}
