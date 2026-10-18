import type { User as FirebaseUser } from 'firebase/auth';

import { AuthenticatedApiError, authenticatedApiRequest } from '@/lib/authenticated-api-client';

import type { EmploymentPeriodInput } from './schemas';
import type { EmploymentHistoryResult } from './presentation';

export type EmploymentReferencePublication = {
  expectedRevision: number;
  requestId: string;
  periods: EmploymentPeriodInput[];
};

function path(userId: string) {
  return `/api/dp/collaborators/${encodeURIComponent(userId)}/employment-reference`;
}

export function loadEmploymentHistory(firebaseUser: FirebaseUser, userId: string) {
  return authenticatedApiRequest<EmploymentHistoryResult>(path(userId), {
    getIdToken: () => firebaseUser.getIdToken(),
    fallbackError: 'Não foi possível carregar as vigências do vínculo.',
  });
}

export function publishEmploymentHistory(firebaseUser: FirebaseUser, userId: string, input: EmploymentReferencePublication) {
  return authenticatedApiRequest<{ historyId: string; revision: number; replayed: boolean }>(path(userId), {
    method: 'PUT',
    json: input,
    getIdToken: () => firebaseUser.getIdToken(),
    fallbackError: 'Não foi possível publicar a vigência do vínculo.',
  });
}

export function employmentPublicationError(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof AuthenticatedApiError && error.status === 409) {
    return {
      conflict: true,
      message: 'O histórico mudou desde a sua leitura. Atualize as vigências, revise os dados e tente novamente.',
    };
  }
  return {
    conflict: false,
    message: error instanceof Error ? error.message : 'Não foi possível publicar a vigência do vínculo.',
  };
}
