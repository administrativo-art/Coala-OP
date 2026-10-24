import 'server-only';

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

import { AppError } from '@/lib/observability/app-error';

export const REP_P_COMPETENCE_FENCES = 'repP_competenceFences';

export function repPCompetenceFenceRef(repDb: Firestore, workspaceId: string, competence: string) {
  return repDb.collection(REP_P_COMPETENCE_FENCES).doc(`${workspaceId}_${competence}`);
}

export function assertRepPCompetenceAcceptsMarking(snapshot: DocumentSnapshot, workspaceId: string, competence: string) {
  const status = snapshot.get('status');
  if (snapshot.exists && snapshot.get('workspaceId') === workspaceId && snapshot.get('competence') === competence
    && (status === 'closing' || status === 'closed')) {
    throw new AppError({ code: 'REP_P_COMPETENCE_CLOSED', kind: 'CONFLICT',
      safeMessage: 'O mês está em fechamento ou já foi fechado. A marcação preservada precisa ser conferida pelo DP.' });
  }
}
