import type { User as FirebaseUser } from 'firebase/auth';

import type { AbsenceRequestOption, AbsenceRequestPreview } from './types';
import type { AbsenceRequestPreviewInput } from './schemas';
import type { AbsenceActionInput, CreateAbsenceDraftInput } from './workflow-schemas';
import type { AbsenceRequestDto } from './workflow-types';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';

const token = (firebaseUser: FirebaseUser) => () => firebaseUser.getIdToken();

export function fetchAbsenceRequestOptions(firebaseUser: FirebaseUser, beneficiaryUid?: string) {
  const query = beneficiaryUid ? `?beneficiaryUid=${encodeURIComponent(beneficiaryUid)}` : '';
  return authenticatedApiRequest<{ absenceTypes: AbsenceRequestOption[]; capabilities?: { canCreate: boolean; catalogDatabase: string } }>(`/api/collaborator/absence-requests/options${query}`, {
    getIdToken: token(firebaseUser),
    fallbackError: 'Não foi possível carregar os tipos de ausência.',
  });
}

export function calculateAbsenceRequestPreview(firebaseUser: FirebaseUser, input: AbsenceRequestPreviewInput, beneficiaryUid?: string) {
  return authenticatedApiRequest<{ preview: AbsenceRequestPreview }>('/api/collaborator/absence-requests/preview', {
    method: 'POST',
    getIdToken: token(firebaseUser),
    json: { ...input, ...(beneficiaryUid ? { beneficiaryUid } : {}) },
    fallbackError: 'Não foi possível calcular a prévia.',
  });
}

export type AbsenceListFilters = { beneficiaryUid?: string; status?: string; unitId?: string; startDate?: string; endDate?: string; overdueOnly?: boolean };
export function listAbsenceRequests(firebaseUser: FirebaseUser, scope: 'mine' | 'review' | 'team', cursor?: string, filters: AbsenceListFilters = {}) {
  const params = new URLSearchParams({ scope, limit: '25' });
  if (cursor) params.set('cursor', cursor);
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '' && value !== false) params.set(key, String(value)); });
  return authenticatedApiRequest<{ requests: AbsenceRequestDto[]; nextCursor: string | null }>(`/api/collaborator/absence-requests?${params}`, {
    getIdToken: token(firebaseUser), fallbackError: 'Não foi possível carregar as ausências.',
  });
}

export function getAbsenceRequest(firebaseUser: FirebaseUser, id: string) {
  return authenticatedApiRequest<{ request: AbsenceRequestDto }>(`/api/collaborator/absence-requests/${encodeURIComponent(id)}`, {
    getIdToken: token(firebaseUser), fallbackError: 'Não foi possível abrir a solicitação.',
  });
}

export function createAbsenceDraft(firebaseUser: FirebaseUser, input: CreateAbsenceDraftInput) {
  return authenticatedApiRequest<{ request: AbsenceRequestDto }>('/api/collaborator/absence-requests', {
    method: 'POST', getIdToken: token(firebaseUser), json: input, fallbackError: 'Não foi possível salvar o rascunho.',
  });
}

export function actOnAbsenceRequest(firebaseUser: FirebaseUser, id: string, input: AbsenceActionInput) {
  return authenticatedApiRequest<{ request: AbsenceRequestDto }>(`/api/collaborator/absence-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH', getIdToken: token(firebaseUser), json: input, fallbackError: 'Não foi possível atualizar a solicitação.',
  });
}

export type AbsenceOperationalAction = 'abort_preparation' | 'activate' | 'reverse';
export function reconcileAbsenceOperational(firebaseUser: FirebaseUser, id: string, input: { expectedVersion: number; action: AbsenceOperationalAction }) {
  return authenticatedApiRequest<{ mode: 'operational'; state: 'aborted' | 'active' | 'reversed'; operationallyApplied: boolean }>(
    `/api/dp/absence-operational/${encodeURIComponent(id)}/reconcile`, {
      method: 'POST', getIdToken: token(firebaseUser), json: input,
      fallbackError: 'Não foi possível reconciliar a aplicação operacional.',
    });
}

export function prepareAbsenceFiles(firebaseUser: FirebaseUser, files: File[], proposedRequestId: string, beneficiaryUid?: string, parentRequestId?: string) {
  const body = new FormData();
  body.set('proposedRequestId', proposedRequestId);
  if (beneficiaryUid) body.set('beneficiaryUid', beneficiaryUid);
  if (parentRequestId) body.set('parentRequestId', parentRequestId);
  files.forEach((file) => body.append('files', file));
  return authenticatedApiRequest<{ proposedRequestId: string; preparationIds: string[]; expiresAt: string }>('/api/collaborator/absence-requests/preparations', {
    method: 'POST', getIdToken: token(firebaseUser), body, fallbackError: 'Não foi possível preparar os comprovantes.',
  });
}

export function reconcileAbsenceNotification(firebaseUser: FirebaseUser, requestId: string) {
  return authenticatedApiRequest<{ state: 'not_due' | 'superseded' | 'retry' | 'completed'; projected?: number }>(
    `/api/collaborator/absence-requests/${encodeURIComponent(requestId)}/notifications/reconcile`, {
      method: 'POST', getIdToken: token(firebaseUser), fallbackError: 'Não foi possível tentar novamente o aviso.',
    });
}

export async function openAbsenceAttachment(firebaseUser: FirebaseUser, requestId: string, fileId: string) {
  const blob = await authenticatedApiRequest<Blob>(`/api/collaborator/absence-requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(fileId)}`, {
    getIdToken: token(firebaseUser), responseType: 'blob', fallbackError: 'Não foi possível abrir o comprovante.',
  });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
