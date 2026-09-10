type ReceiptReversalState = {
  status?: string;
  conferenceStartedAt?: unknown;
  conferenceCompletedAt?: unknown;
  stockEntryStartedAt?: unknown;
  stockEnteredAt?: unknown;
  receivedAt?: unknown;
};

type FinancialReversalState = {
  status?: string;
};

export function purchaseExpenseHasSettlementEvidence(expense: Record<string, unknown>) {
  if (expense.status === 'paid' || expense.status === 'partially_paid') return true;
  if (expense.paidAt || expense.linkedBankTransactionId || expense.paymentRequestId) return true;

  return Array.isArray(expense.installments) && expense.installments.some((installment) => {
    if (!installment || typeof installment !== 'object') return false;
    const data = installment as Record<string, unknown>;
    return (
      data.status === 'paid' ||
      data.status === 'partially_paid' ||
      Boolean(data.paidAt || data.linkedBankTransactionId || data.paymentRequestId)
    );
  });
}

export function getPurchaseStageReversalBlockReason(input: {
  orderStatus?: string;
  orderReceivedAt?: unknown;
  receipts: ReceiptReversalState[];
  financials: FinancialReversalState[];
}) {
  if (input.orderStatus !== 'confirmed') {
    return 'Apenas pedidos confirmados podem voltar para a etapa de revisão.';
  }

  if (input.orderReceivedAt) {
    return 'O pedido já foi recebido. Reverta primeiro as movimentações operacionais vinculadas.';
  }

  const activeReceipts = input.receipts.filter((receipt) => receipt.status !== 'cancelled');
  const receiptHasProgress = activeReceipts.some(
    (receipt) =>
      receipt.status !== 'awaiting_delivery' ||
      Boolean(
        receipt.conferenceStartedAt ||
          receipt.conferenceCompletedAt ||
          receipt.stockEntryStartedAt ||
          receipt.stockEnteredAt ||
          receipt.receivedAt,
      ),
  );
  if (receiptHasProgress) {
    return 'O recebimento já foi iniciado. Retroceda ou encerre a conferência antes de voltar o pedido.';
  }

  if (input.financials.some((financial) => financial.status === 'paid')) {
    return 'O pedido possui pagamento registrado. Estorne o pagamento antes de retroceder a etapa.';
  }

  return null;
}
