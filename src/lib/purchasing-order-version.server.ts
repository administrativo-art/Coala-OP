import type { DocumentReference, DocumentSnapshot, UpdateData, WriteBatch } from 'firebase-admin/firestore';

/** The parent version serializes order edits, item edits and confirmation. */
export async function commitVersionedPurchaseOrderBatch(
  batch: WriteBatch,
  orderRef: DocumentReference,
  orderSnapshot: DocumentSnapshot,
  orderUpdate: UpdateData<FirebaseFirestore.DocumentData>,
): Promise<boolean> {
  if (!orderSnapshot.exists || !orderSnapshot.updateTime) return false;
  batch.update(orderRef, orderUpdate, { lastUpdateTime: orderSnapshot.updateTime });
  try {
    await batch.commit();
    return true;
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 9 || code === 'FAILED_PRECONDITION' || code === 'failed-precondition') return false;
    throw error;
  }
}
