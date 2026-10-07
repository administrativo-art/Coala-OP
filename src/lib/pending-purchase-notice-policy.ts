import { z } from 'zod';
import type { ServerUserContext } from '@/lib/auth-server';
import { canReceivePurchase, canViewPurchasing } from '@/lib/purchasing-permissions';
import { canAccessUnit } from '@/lib/unit-access';
import { AppError } from '@/lib/observability/app-error';

export const ACTIVE_NOTICE_RECEIPT_STATUSES = [
  'awaiting_delivery', 'in_conference', 'awaiting_stock', 'in_stock_entry', 'partially_stocked',
] as const;

const id = z.string().trim().min(1).max(256).refine(value => !value.includes('/'));
export const ignoreNoticeSchema = z.object({
  purchaseReceiptId: id, purchaseReceiptItemId: id, destinationKioskId: id,
  reason: z.string().trim().min(3).max(500),
});
export type IgnoreNoticeInput = z.infer<typeof ignoreNoticeSchema>;

export function assertNoticeAccess(user: ServerUserContext, destination: string, action: 'read' | 'ignore') {
  const permitted = action === 'read'
    ? user.permissions.stock.view || canViewPurchasing(user.permissions)
    : canReceivePurchase(user.permissions);
  if ((!user.isDefaultAdmin && !permitted) || !id.safeParse(destination).success ||
    !canAccessUnit(user.userDoc, destination, { isDefaultAdmin: user.isDefaultAdmin })) {
    throw new AppError({ code: 'NOTICE_ACCESS_DENIED', kind: 'AUTHORIZATION' });
  }
}

/** Closed commercial shortage is not an expected delivery; received stock stays separate. */
export function pendingNoticeQuantities(item: Record<string, unknown>) {
  if (item.noticeIgnoredAt || item.status === 'cancelled') return null;
  const ordered = Number(item.quantityOrdered);
  const received = Number(item.quantityReceived ?? 0);
  const awaitingEntry = Number(item.quantityPendingStockEntry ?? 0);
  if (![ordered, received, awaitingEntry].every(value => Number.isFinite(value) && value >= 0)) {
    throw new AppError({ code: 'NOTICE_QUANTITY_INVALID', kind: 'DATA_INTEGRITY', httpStatus: 409,
      safeMessage: 'Há quantidades inconsistentes no recebimento; confira os dados antes de usar os avisos.' });
  }
  const closedActions = new Set(['accept_charged', 'bonus', 'return_excess', 'close_shortage', 'credit_discount', 'correct_entry']);
  const closed = closedActions.has(String(item.divergenceResolutionAction ?? ''));
  const notReceived = closed ? 0 : Math.max(0, ordered - received);
  return notReceived || awaitingEntry
    ? { quantityNotReceived: notReceived, quantityPendingStockEntry: awaitingEntry } : null;
}
