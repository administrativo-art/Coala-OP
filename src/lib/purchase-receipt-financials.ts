export type PurchaseFinancialStatus = 'forecasted' | 'divergent' | 'confirmed';

export function computeReceiptFinancialUpdate(params: {
  totalConfirmed: number;
  deliveryFee: number;
  amountEstimated: number;
  receiptMode: string | undefined;
  hasRemaining: boolean;
  hasDivergence: boolean;
}): { status: PurchaseFinancialStatus; amountConfirmed: number } {
  const amountConfirmed = params.totalConfirmed + params.deliveryFee;
  const wasDivergent =
    params.receiptMode === 'future_delivery' &&
    Math.abs(amountConfirmed - params.amountEstimated) > 0.01;

  return {
    amountConfirmed,
    status: params.hasRemaining ? 'forecasted' : wasDivergent || params.hasDivergence ? 'divergent' : 'confirmed',
  };
}
