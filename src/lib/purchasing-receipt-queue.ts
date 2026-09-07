import type { PurchaseOrder } from '@/types';

type ReceiptQueueOrder = Pick<PurchaseOrder, 'status' | 'receivedAt'>;

export function isConfirmedOrderAwaitingReceipt(
  order: ReceiptQueueOrder | null | undefined,
): boolean {
  return order?.status === 'confirmed' && !order.receivedAt;
}
