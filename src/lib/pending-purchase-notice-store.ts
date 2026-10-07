import type { Firestore } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { ACTIVE_NOTICE_RECEIPT_STATUSES, assertNoticeAccess, pendingNoticeQuantities,
  type IgnoreNoticeInput } from '@/lib/pending-purchase-notice-policy';

/** Operational metadata only; no purchase transition, stock entry or financial write. */
export async function ignorePendingPurchaseNotice(db: Firestore, user: ServerUserContext, input: IgnoreNoticeInput) {
  assertNoticeAccess(user, input.destinationKioskId, 'ignore');
  const receiptRef = db.collection('purchase_receipts').doc(input.purchaseReceiptId);
  const itemRef = receiptRef.collection('items').doc(input.purchaseReceiptItemId);
  return db.runTransaction(async transaction => {
    const [receipt, item] = await Promise.all([transaction.get(receiptRef), transaction.get(itemRef)]);
    if (!receipt.exists || !item.exists || receipt.get('workspaceId') !== user.workspace_id ||
      receipt.get('destinationKioskId') !== input.destinationKioskId ||
      !(ACTIVE_NOTICE_RECEIPT_STATUSES as readonly string[]).includes(receipt.get('status'))) return 'not_found';
    if (item.get('noticeIgnoredAt')) return 'already_ignored';
    if (!pendingNoticeQuantities(item.data() ?? {})) return 'not_found';
    transaction.update(itemRef, {
      noticeIgnoredAt: new Date().toISOString(), noticeIgnoredBy: user.decoded.uid,
      noticeIgnoreReason: input.reason,
    });
    return 'ignored';
  });
}
