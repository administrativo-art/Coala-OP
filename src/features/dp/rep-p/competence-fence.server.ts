import 'server-only';

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

import { AppError } from '@/lib/observability/app-error';

export const REP_P_COMPETENCE_FENCES = 'repP_competenceFences';

export function repPCompetenceFenceRef(repDb: Firestore, workspaceId: string, competence: string) {
  return repDb.collection(REP_P_COMPETENCE_FENCES).doc(`${workspaceId}_${competence}`);
}

/** Serializes schedule publication with PTRP closure across the two Firestore databases. */
export async function holdRepPCompetenceForSchedulePublication(repDb: Firestore, workspaceId: string, competence: string) {
  const ref = repPCompetenceFenceRef(repDb, workspaceId, competence);
  const token = randomUUID();
  await repDb.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists && (current.get('workspaceId') !== workspaceId || current.get('competence') !== competence)) {
      throw new AppError({ code: 'DP_SCHEDULE_CLOSURE_FENCE_INVALID', kind: 'DATA_INTEGRITY',
        safeMessage: 'A trava da competência está inconsistente.' });
    }
    if (current.exists && current.get('status') !== 'open') {
      throw new AppError({ code: 'DP_SCHEDULE_COMPETENCE_CLOSED', kind: 'CONFLICT',
        safeMessage: 'A competência está em fechamento, fechada ou outra publicação está em andamento.' });
    }
    tx.set(ref, { schemaVersion: 1, workspaceId, competence, status: 'publishing', token,
      updatedAt: new Date().toISOString() }, { merge: true });
  });
  return async () => {
    await repDb.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.exists || current.get('status') !== 'publishing' || current.get('token') !== token) {
        throw new AppError({ code: 'DP_SCHEDULE_CLOSURE_FENCE_LOST', kind: 'CONFLICT',
          safeMessage: 'A trava da competência mudou durante a publicação.' });
      }
      tx.set(ref, { status: 'open', token: null, updatedAt: new Date().toISOString() }, { merge: true });
    });
  };
}

export function assertRepPCompetenceAcceptsMarking(snapshot: DocumentSnapshot, workspaceId: string, competence: string) {
  const status = snapshot.get('status');
  if (snapshot.exists && snapshot.get('workspaceId') === workspaceId && snapshot.get('competence') === competence
    && (status === 'closing' || status === 'closed')) {
    throw new AppError({ code: 'REP_P_COMPETENCE_CLOSED', kind: 'CONFLICT',
      safeMessage: 'O mês está em fechamento ou já foi fechado. A marcação preservada precisa ser conferida pelo DP.' });
  }
}
