import { createHash } from 'node:crypto';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  decideUberTripMatch,
  recognizeUberFinancialCandidate,
  uberMatchKeys,
  uberTripDocumentId,
  uberTripMatchCandidate,
  uberTripPrimaryMatchKey,
  type UberFinancialCandidate,
  type UberMatchDecision,
  type UberTripAggregate,
  type UberTripMatchCandidate,
} from './domain.js';

const financialDb = getFirestore('coala-financeiro');
const MAX_TRANSACTIONS_PER_TRIP = 50;
const MATCH_QUERY_LIMIT = 11;
const RECONCILIATION_BATCH_SIZE = 30;
const RECONCILIATION_CANDIDATE_LIMIT = 301;

type FinancialEntityKind = UberFinancialCandidate['entityKind'];

export type UberImportSource = {
  id: string;
  fileName: string;
  remotePath: string;
  remoteSize: number;
  remoteModifiedAt: number;
  checksumSha256: string;
};

export type UberTripUpsertResult = {
  documentId: string;
  primaryMatchKey: string | null;
  previouslyLinkedEntities: Array<{ entityKind: FinancialEntityKind; entityId: string }>;
};

function entityCollection(entityKind: FinancialEntityKind) {
  return entityKind === 'expense' ? 'expenses' : 'transactions';
}

function reconciliationDocumentId(entityKind: FinancialEntityKind, entityId: string) {
  return `${entityKind}_${createHash('sha256').update(entityId).digest('hex').slice(0, 40)}`;
}

function uniqueText(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function transactionRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const fingerprint = String(row.fingerprint ?? '').trim();
    const amountCents = Number(row.amountCents);
    return fingerprint && Number.isInteger(amountCents) ? [{ ...row, fingerprint, amountCents }] : [];
  });
}

function tripCandidateFromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return snapshot.exists
    ? uberTripMatchCandidate(snapshot.id, snapshot.data() ?? {})
    : null;
}

function tripLinkField(entityKind: FinancialEntityKind) {
  return entityKind === 'expense' ? 'matchedExpenseIds' : 'matchedTransactionIds';
}

function reconciliationStatusAfterUnlink(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  entityKind: FinancialEntityKind,
  entityId: string,
) {
  const data = snapshot.data() ?? {};
  const matchedExpenseIds = uniqueText(data.matchedExpenseIds)
    .filter((id) => entityKind !== 'expense' || id !== entityId);
  const matchedTransactionIds = uniqueText(data.matchedTransactionIds)
    .filter((id) => entityKind !== 'transaction' || id !== entityId);
  return matchedExpenseIds.length || matchedTransactionIds.length ? 'matched' : 'waiting_for_expense';
}

function tripIdsFromDecision(decision: UberMatchDecision) {
  if (decision.status === 'matched') return [decision.trip.documentId];
  return decision.status === 'ambiguous' ? decision.tripDocumentIds : [];
}

function matchReason(decision: UberMatchDecision) {
  if (decision.status === 'matched') return 'exact_amount_currency_date_window';
  return decision.reason;
}

function clearedTripFields() {
  return {
    uberTripDocumentId: FieldValue.delete(),
    uberTripId: FieldValue.delete(),
    uberRequesterName: FieldValue.delete(),
    uberRequesterEmail: FieldValue.delete(),
    uberEmployeeId: FieldValue.delete(),
    uberService: FieldValue.delete(),
    uberRequestDateLocal: FieldValue.delete(),
    uberTripAmount: FieldValue.delete(),
    uberTripAmountCents: FieldValue.delete(),
    uberTripCurrency: FieldValue.delete(),
    uberReceiptUrl: FieldValue.delete(),
    uberMatchedAt: FieldValue.delete(),
    uberMatchConfidence: FieldValue.delete(),
  };
}

export function uberImportDocumentId(remotePath: string) {
  return `uber_file_${createHash('sha256').update(remotePath).digest('hex').slice(0, 40)}`;
}

export async function claimUberImport(source: Omit<UberImportSource, 'checksumSha256'>) {
  const reference = financialDb.collection('uberSftpImports').doc(source.id);
  return financialDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() ?? {};
    const sameRemoteVersion = current.remoteSize === source.remoteSize
      && current.remoteModifiedAt === source.remoteModifiedAt;
    if (current.status === 'completed' && sameRemoteVersion) return false;
    const startedAt = current.startedAt && typeof current.startedAt.toMillis === 'function'
      ? current.startedAt.toMillis()
      : 0;
    if (current.status === 'processing' && sameRemoteVersion && Date.now() - startedAt < 30 * 60_000) {
      return false;
    }
    const now = Timestamp.now();
    transaction.set(reference, {
      ...source,
      status: 'processing',
      attempt: FieldValue.increment(1),
      startedAt: now,
      updatedAt: now,
      lastErrorEventId: FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

export async function completeUberImport(source: UberImportSource, result: { rowCount: number; tripCount: number }) {
  const now = Timestamp.now();
  await financialDb.collection('uberSftpImports').doc(source.id).set({
    ...source,
    ...result,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    lastErrorEventId: FieldValue.delete(),
  }, { merge: true });
}

export async function failUberImport(importId: string, eventId: string) {
  await financialDb.collection('uberSftpImports').doc(importId).set({
    status: 'failed',
    lastErrorEventId: eventId,
    failedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function upsertUberTrip(trip: UberTripAggregate, source: UberImportSource): Promise<UberTripUpsertResult> {
  const documentId = uberTripDocumentId(trip.tripId, trip.currencyCode);
  const reference = financialDb.collection('uberTrips').doc(documentId);
  return financialDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() ?? {};
    const existingRows = transactionRows(current.transactions);
    const combinedRows = [...new Map(
      [...existingRows, ...trip.transactions].map((row) => [String(row.fingerprint), row]),
    ).values()];
    if (combinedRows.length > MAX_TRANSACTIONS_PER_TRIP) throw new Error('UBER_TRIP_TRANSACTION_LIMIT_EXCEEDED');
    const transactionAmountCents = combinedRows.reduce((sum, row) => sum + Number(row.amountCents), 0);
    const aggregate = { ...trip, transactionAmountCents };
    const primaryMatchKey = transactionAmountCents > 0 ? uberTripPrimaryMatchKey(aggregate) : null;
    const matchKeys = transactionAmountCents > 0
      ? uberMatchKeys(trip.currencyCode, transactionAmountCents, trip.requestDateLocal)
      : [];
    const matchedExpenseIds = uniqueText(current.matchedExpenseIds);
    const matchedTransactionIds = uniqueText(current.matchedTransactionIds);
    const now = Timestamp.now();
    transaction.set(reference, {
      provider: 'uber',
      tripId: trip.tripId,
      requestDateLocal: trip.requestDateLocal,
      requestTimeLocal: trip.requestTimeLocal || current.requestTimeLocal || null,
      transactionTimestampUtc: trip.transactionTimestampUtc || current.transactionTimestampUtc || null,
      requesterFirstName: trip.requesterFirstName || current.requesterFirstName || null,
      requesterLastName: trip.requesterLastName || current.requesterLastName || null,
      requesterName: trip.requesterName || current.requesterName || null,
      requesterEmail: trip.requesterEmail || current.requesterEmail || null,
      employeeId: trip.employeeId || current.employeeId || null,
      guestFirstName: trip.guestFirstName || current.guestFirstName || null,
      guestLastName: trip.guestLastName || current.guestLastName || null,
      guestName: trip.guestName || current.guestName || null,
      service: trip.service || current.service || null,
      program: trip.program || current.program || null,
      paymentMethod: trip.paymentMethod || current.paymentMethod || null,
      currencyCode: trip.currencyCode,
      transactionAmountCents,
      transactionAmount: transactionAmountCents / 100,
      receiptUrl: trip.receiptUrl || current.receiptUrl || null,
      transactions: combinedRows,
      primaryMatchKey,
      matchKeys,
      matchedExpenseIds,
      matchedTransactionIds,
      reconciliationStatus: matchedExpenseIds.length || matchedTransactionIds.length ? 'matched' : 'waiting_for_expense',
      sourceFileIds: [...new Set([...uniqueText(current.sourceFileIds), source.id])],
      sourceFileNames: [...new Set([...uniqueText(current.sourceFileNames), source.fileName])],
      lastImportedAt: now,
      updatedAt: now,
      ...(!snapshot.exists ? { createdAt: now } : {}),
    }, { merge: true });
    return {
      documentId,
      primaryMatchKey,
      previouslyLinkedEntities: [
        ...matchedExpenseIds.map((entityId) => ({ entityKind: 'expense' as const, entityId })),
        ...matchedTransactionIds.map((entityId) => ({ entityKind: 'transaction' as const, entityId })),
      ],
    };
  });
}

async function queryTripCandidates(primaryMatchKey: string) {
  const snapshot = await financialDb.collection('uberTrips')
    .where('matchKeys', 'array-contains', primaryMatchKey)
    .limit(MATCH_QUERY_LIMIT)
    .get();
  return snapshot.docs
    .map((document) => uberTripMatchCandidate(document.id, document.data()))
    .filter((trip): trip is UberTripMatchCandidate => trip !== null);
}

async function clearCandidate(entityKind: FinancialEntityKind, entityId: string, data: Record<string, unknown>) {
  const hintedPreviousTripDocumentId = String(data.uberTripDocumentId ?? '').trim();
  if (!data.uberCandidate && !data.uberRecognitionFingerprint && !hintedPreviousTripDocumentId) return;
  const entityRef = financialDb.collection(entityCollection(entityKind)).doc(entityId);
  const reconciliationRef = financialDb.collection('uberReconciliations')
    .doc(reconciliationDocumentId(entityKind, entityId));
  await financialDb.runTransaction(async (transaction) => {
    const entitySnapshot = await transaction.get(entityRef);
    if (!entitySnapshot.exists) return;
    const liveData = entitySnapshot.data() ?? {};
    if (recognizeUberFinancialCandidate(entityKind, entityId, liveData)) return;
    const previousTripDocumentId = String(liveData.uberTripDocumentId ?? '').trim();
    const [previousTripSnapshot, reconciliationSnapshot] = await Promise.all([
      previousTripDocumentId
        ? transaction.get(financialDb.collection('uberTrips').doc(previousTripDocumentId))
        : Promise.resolve(null),
      transaction.get(reconciliationRef),
    ]);
    if (previousTripSnapshot?.exists) {
      transaction.set(previousTripSnapshot.ref, {
        [tripLinkField(entityKind)]: FieldValue.arrayRemove(entityId),
        reconciliationStatus: reconciliationStatusAfterUnlink(previousTripSnapshot, entityKind, entityId),
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    const now = Timestamp.now();
    transaction.set(entityRef, {
      uberCandidate: false,
      uberRecognitionStatus: 'not_candidate',
      uberMatchKeys: FieldValue.delete(),
      uberPrimaryMatchKey: FieldValue.delete(),
      uberRecognitionFingerprint: FieldValue.delete(),
      ...clearedTripFields(),
      uberRecognitionUpdatedAt: now,
    }, { merge: true });
    transaction.set(reconciliationRef, {
      provider: 'uber',
      entityKind,
      entityId,
      status: 'not_candidate',
      previousTripDocumentId: previousTripDocumentId || null,
      createdAt: reconciliationSnapshot.get('createdAt') || now,
      updatedAt: now,
    }, { merge: true });
  });
}

export async function removeDeletedUberFinancialCandidate(
  entityKind: FinancialEntityKind,
  entityId: string,
  data: Record<string, unknown>,
) {
  const previousTripDocumentId = String(data.uberTripDocumentId ?? '').trim();
  if (!data.uberCandidate && !data.uberRecognitionFingerprint && !previousTripDocumentId) return;
  const reconciliationRef = financialDb.collection('uberReconciliations')
    .doc(reconciliationDocumentId(entityKind, entityId));
  await financialDb.runTransaction(async (transaction) => {
    const [previousTripSnapshot, reconciliationSnapshot] = await Promise.all([
      previousTripDocumentId
        ? transaction.get(financialDb.collection('uberTrips').doc(previousTripDocumentId))
        : Promise.resolve(null),
      transaction.get(reconciliationRef),
    ]);
    const now = Timestamp.now();
    if (previousTripSnapshot?.exists) {
      transaction.set(previousTripSnapshot.ref, {
        [tripLinkField(entityKind)]: FieldValue.arrayRemove(entityId),
        reconciliationStatus: reconciliationStatusAfterUnlink(previousTripSnapshot, entityKind, entityId),
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(reconciliationRef, {
      provider: 'uber',
      entityKind,
      entityId,
      status: 'entity_deleted',
      previousTripDocumentId: previousTripDocumentId || null,
      createdAt: reconciliationSnapshot.get('createdAt') || now,
      deletedAt: now,
      updatedAt: now,
    }, { merge: true });
  });
}

async function applyDecision(
  candidate: UberFinancialCandidate,
  queriedTrips: UberTripMatchCandidate[],
) {
  const entityRef = financialDb.collection(entityCollection(candidate.entityKind)).doc(candidate.entityId);
  const reconciliationRef = financialDb.collection('uberReconciliations')
    .doc(reconciliationDocumentId(candidate.entityKind, candidate.entityId));
  const queriedTripRefs = queriedTrips.map((trip) => financialDb.collection('uberTrips').doc(trip.documentId));

  await financialDb.runTransaction(async (transaction) => {
    const entitySnapshot = await transaction.get(entityRef);
    if (!entitySnapshot.exists) return;
    const liveData = entitySnapshot.data() ?? {};
    const liveCandidate = recognizeUberFinancialCandidate(candidate.entityKind, candidate.entityId, liveData);
    if (!liveCandidate || liveCandidate.inputFingerprint !== candidate.inputFingerprint) return;
    const previousTripDocumentId = String(liveData.uberTripDocumentId ?? '').trim();
    const allTripRefs = [...new Map([
      ...queriedTripRefs,
      ...(previousTripDocumentId ? [financialDb.collection('uberTrips').doc(previousTripDocumentId)] : []),
    ].map((reference) => [reference.path, reference])).values()];
    const [tripSnapshots, reconciliationSnapshot] = await Promise.all([
      Promise.all(allTripRefs.map((reference) => transaction.get(reference))),
      transaction.get(reconciliationRef),
    ]);
    const liveTrips = tripSnapshots
      .map(tripCandidateFromSnapshot)
      .filter((trip): trip is UberTripMatchCandidate => trip !== null);
    const decision = decideUberTripMatch(liveCandidate, liveTrips);
    const selectedTripDocumentId = decision.status === 'matched' ? decision.trip.documentId : '';
    const now = Timestamp.now();

    if (previousTripDocumentId && previousTripDocumentId !== selectedTripDocumentId) {
      const previousTripSnapshot = tripSnapshots.find((snapshot) => snapshot.id === previousTripDocumentId);
      if (previousTripSnapshot?.exists) {
        transaction.set(previousTripSnapshot.ref, {
          [tripLinkField(candidate.entityKind)]: FieldValue.arrayRemove(candidate.entityId),
          reconciliationStatus: reconciliationStatusAfterUnlink(
            previousTripSnapshot,
            candidate.entityKind,
            candidate.entityId,
          ),
          updatedAt: now,
        }, { merge: true });
      }
    }

    const commonPatch = {
      uberCandidate: true,
      uberProvider: 'uber',
      uberRecognitionStatus: decision.status,
      uberMatchKeys: liveCandidate.matchKeys,
      uberPrimaryMatchKey: liveCandidate.primaryMatchKey,
      uberRecognitionFingerprint: liveCandidate.inputFingerprint,
      uberRecognizedAt: liveData.uberRecognizedAt || now,
      uberRecognitionUpdatedAt: now,
    };

    if (decision.status === 'matched') {
      const trip = decision.trip;
      const tripSnapshot = tripSnapshots.find((snapshot) => snapshot.id === trip.documentId);
      if (!tripSnapshot?.exists) return;
      transaction.set(entityRef, {
        ...commonPatch,
        uberTripDocumentId: trip.documentId,
        uberTripId: trip.tripId,
        uberRequesterName: trip.requesterName,
        uberRequesterEmail: trip.requesterEmail,
        uberEmployeeId: trip.employeeId,
        uberService: trip.service,
        uberRequestDateLocal: trip.requestDateLocal,
        uberTripAmount: trip.transactionAmountCents / 100,
        uberTripAmountCents: trip.transactionAmountCents,
        uberTripCurrency: trip.currencyCode,
        uberReceiptUrl: trip.receiptUrl,
        uberMatchedAt: now,
        uberMatchConfidence: 'high',
      }, { merge: true });
      transaction.set(tripSnapshot.ref, {
        [tripLinkField(candidate.entityKind)]: FieldValue.arrayUnion(candidate.entityId),
        reconciliationStatus: 'matched',
        lastReconciledAt: now,
        updatedAt: now,
      }, { merge: true });
    } else {
      transaction.set(entityRef, {
        ...commonPatch,
        ...clearedTripFields(),
      }, { merge: true });
    }

    transaction.set(reconciliationRef, {
      provider: 'uber',
      entityKind: candidate.entityKind,
      entityId: candidate.entityId,
      status: decision.status,
      reason: matchReason(decision),
      tripDocumentIds: tripIdsFromDecision(decision),
      tripDocumentId: selectedTripDocumentId || null,
      candidateFingerprint: candidate.inputFingerprint,
      amountCents: candidate.amountCents,
      currencyCode: candidate.currencyCode,
      eventDate: candidate.eventDate,
      createdAt: reconciliationSnapshot.get('createdAt') || now,
      updatedAt: now,
    }, { merge: true });
  });
}

export async function synchronizeUberFinancialCandidate(
  entityKind: FinancialEntityKind,
  entityId: string,
  data: Record<string, unknown>,
  options: { force?: boolean } = {},
) {
  const candidate = recognizeUberFinancialCandidate(entityKind, entityId, data);
  if (!candidate) {
    await clearCandidate(entityKind, entityId, data);
    return 'not_candidate' as const;
  }
  if (!options.force && data.uberRecognitionFingerprint === candidate.inputFingerprint) {
    return 'unchanged' as const;
  }
  const trips = await queryTripCandidates(candidate.primaryMatchKey);
  await applyDecision(candidate, trips);
  return decideUberTripMatch(candidate, trips).status;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function reconcileUberCandidatesForTripKeys(primaryMatchKeys: string[]) {
  const uniqueKeys = [...new Set(primaryMatchKeys.filter(Boolean))];
  let reconciled = 0;
  for (const keyChunk of chunks(uniqueKeys, RECONCILIATION_BATCH_SIZE)) {
    for (const entityKind of ['expense', 'transaction'] as const) {
      const snapshot = await financialDb.collection(entityCollection(entityKind))
        .where('uberMatchKeys', 'array-contains-any', keyChunk)
        .limit(RECONCILIATION_CANDIDATE_LIMIT)
        .get();
      if (snapshot.size >= RECONCILIATION_CANDIDATE_LIMIT) {
        throw new Error('UBER_RECONCILIATION_CANDIDATE_LIMIT_EXCEEDED');
      }
      for (const document of snapshot.docs) {
        await synchronizeUberFinancialCandidate(entityKind, document.id, document.data(), { force: true });
        reconciled += 1;
      }
    }
  }
  return reconciled;
}

export async function reconcilePreviouslyLinkedUberCandidates(
  linked: Array<{ entityKind: FinancialEntityKind; entityId: string }>,
) {
  let reconciled = 0;
  const unique = [...new Map(linked.map((entry) => [`${entry.entityKind}:${entry.entityId}`, entry])).values()];
  for (const entry of unique) {
    const snapshot = await financialDb.collection(entityCollection(entry.entityKind)).doc(entry.entityId).get();
    if (!snapshot.exists) continue;
    await synchronizeUberFinancialCandidate(entry.entityKind, entry.entityId, snapshot.data() ?? {}, { force: true });
    reconciled += 1;
  }
  return reconciled;
}
