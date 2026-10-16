import 'server-only';

import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { AppError } from '@/lib/observability/app-error';

export const EMPLOYMENT_CYCLE_FIELDS = new Set([
  'isActive',
  'employmentStatus',
  'employmentRelationshipType',
  'admissionDate',
  'terminationDate',
  'terminationRelationshipType',
  'terminationProcessId',
]);

export function storedEmploymentCycleVersion(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function hasEmploymentCycleFields(patch: Record<string, unknown>) {
  return Object.keys(patch).some((field) => EMPLOYMENT_CYCLE_FIELDS.has(field));
}
export function assertEmploymentCycleUnlocked(snapshot: DocumentSnapshot) {
  const fence = snapshot.get('absenceDocumentDeletionFence');
  if (fence && typeof fence === 'object') {
    throw new AppError({
      code: 'EMPLOYMENT_CYCLE_DOCUMENT_DELETION_IN_PROGRESS',
      kind: 'CONFLICT',
      safeMessage: 'O vínculo está temporariamente bloqueado por uma exclusão documental em andamento.',
    });
  }
}
/**
 * Applies an employment-cycle mutation inside the caller's Coala transaction.
 * Every readmission, termination or correction must use this helper so the
 * absence-document fence and the monotonic version are checked atomically.
 */
export function setEmploymentCyclePatch(transaction: Transaction, userRef: DocumentReference,
  snapshot: DocumentSnapshot, patch: Record<string, unknown>, options: { cycleMutation: boolean }) {
  if (!snapshot.exists) {
    transaction.set(userRef, { ...patch, employmentCycleVersion: 0 }, { merge: true });
    return 0;
  }
  if (!options.cycleMutation) {
    transaction.set(userRef, patch, { merge: true });
    return storedEmploymentCycleVersion(snapshot.get('employmentCycleVersion'));
  }
  assertEmploymentCycleUnlocked(snapshot);
  const nextVersion = storedEmploymentCycleVersion(snapshot.get('employmentCycleVersion')) + 1;
  transaction.set(userRef, { ...patch, employmentCycleVersion: nextVersion }, { merge: true });
  return nextVersion;
}
