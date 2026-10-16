import { type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export function storedEmploymentCycleVersion(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** Functions-side equivalent of the application guard; keep both runtimes on the same document contract. */
export function setEmploymentCyclePatch(transaction: Transaction, userRef: DocumentReference,
  snapshot: DocumentSnapshot, patch: Record<string, unknown>, cycleMutation: boolean) {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Usuário não encontrado.');
  if (!cycleMutation) {
    transaction.set(userRef, patch, { merge: true });
    return storedEmploymentCycleVersion(snapshot.get('employmentCycleVersion'));
  }
  const fence = snapshot.get('absenceDocumentDeletionFence');
  if (fence && typeof fence === 'object') {
    throw new HttpsError('failed-precondition',
      'O vínculo está temporariamente bloqueado por uma exclusão documental em andamento.');
  }
  const nextVersion = storedEmploymentCycleVersion(snapshot.get('employmentCycleVersion')) + 1;
  transaction.set(userRef, { ...patch, employmentCycleVersion: nextVersion }, { merge: true });
  return nextVersion;
}
