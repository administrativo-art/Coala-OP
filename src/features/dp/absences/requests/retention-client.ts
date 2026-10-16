import type { User as FirebaseUser } from 'firebase/auth';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';

export type AbsenceRetentionState = 'unanchored' | 'scheduled' | 'awaiting_authorization' | 'authorized'
  | 'retained_until_review' | 'needs_revalidation' | 'execution_blocked' | 'preparing_execution'
  | 'executing' | 'execution_unknown' | 'release_pending' | 'execution_review_required' | 'removed';
export type AbsenceRetentionCase = {
  id: string; requestId: string; fileId: string; beneficiaryUid: string; unitId: string;
  custodianUid: string | null; state: AbsenceRetentionState; version: number;
  reviewAfter: string | null; updatedAt: string;
  decision: { action: 'authorize_delete' | 'retain'; actorUid: string; reason: string; at: string; nextReviewAfter?: string } | null;
};
export type AbsenceRetentionDecision = {
  action: 'authorize_delete' | 'retain'; reason: string; expectedVersion: number; operationId: string;
  nextReviewAfter?: string;
};

export function retentionListPath(input: { unitId: string; state?: AbsenceRetentionState; cursor?: string; limit?: number }) {
  if (!input.unitId) throw new Error('Selecione uma unidade antes de consultar a retenção.');
  const query = new URLSearchParams({ unitId: input.unitId, limit: String(input.limit ?? 25) });
  if (input.state) query.set('state', input.state);
  if (input.cursor) query.set('cursor', input.cursor);
  return `/api/dp/absence-retention?${query}`;
}

export function retentionDecisionPath(caseId: string) {
  return `/api/dp/absence-retention/${encodeURIComponent(caseId)}/decision`;
}

export function retentionExecutionPath(caseId: string) {
  return `/api/dp/absence-retention/${encodeURIComponent(caseId)}/execute`;
}

export function listAbsenceRetentionCases(firebaseUser: FirebaseUser, input: Parameters<typeof retentionListPath>[0]) {
  return authenticatedApiRequest<{ cases: AbsenceRetentionCase[]; nextCursor: string | null }>(retentionListPath(input), {
    getIdToken: () => firebaseUser.getIdToken(), fallbackError: 'Não foi possível carregar a fila de retenção.',
  });
}

export function decideAbsenceRetention(firebaseUser: FirebaseUser, caseId: string, input: AbsenceRetentionDecision) {
  return authenticatedApiRequest<AbsenceRetentionCase & { replayed: boolean }>(retentionDecisionPath(caseId), {
    method: 'POST', getIdToken: () => firebaseUser.getIdToken(), json: input,
    fallbackError: 'Não foi possível confirmar a decisão de retenção.',
  });
}

export function executeAbsenceRetention(firebaseUser: FirebaseUser, caseId: string,
  input: { expectedVersion: number; operationId: string }) {
  return authenticatedApiRequest<AbsenceRetentionCase & { replayed: boolean }>(retentionExecutionPath(caseId), {
    method: 'POST', getIdToken: () => firebaseUser.getIdToken(), json: input,
    fallbackError: 'Não foi possível concluir a exclusão do documento.',
  });
}
