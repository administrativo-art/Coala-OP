import type { User as FirebaseUser } from 'firebase/auth';

import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import type { AbsenceCoverageDecisionInput } from './schemas';
import type { AbsenceCoverageCandidate, AbsenceCoverageView } from './types';

const token = (user: FirebaseUser) => () => user.getIdToken();
const base = (requestId: string) => `/api/dp/absence-coverage/${encodeURIComponent(requestId)}`;

export function fetchAbsenceCoverage(user: FirebaseUser, requestId: string) {
  return authenticatedApiRequest<{ coverage: AbsenceCoverageView | null }>(base(requestId), {
    getIdToken: token(user), fallbackError: 'Não foi possível carregar a cobertura do turno.',
  });
}

export function fetchAbsenceCoverageCandidates(user: FirebaseUser, requestId: string, input: { displacedId: string; search?: string }) {
  const params = new URLSearchParams({ displacedId: input.displacedId });
  if (input.search?.trim()) params.set('search', input.search.trim());
  return authenticatedApiRequest<{ candidates: AbsenceCoverageCandidate[] }>(`${base(requestId)}/candidates?${params}`, {
    getIdToken: token(user), fallbackError: 'Não foi possível conferir quem pode cobrir.',
  });
}

export function decideAbsenceCoverage(user: FirebaseUser, requestId: string, input: AbsenceCoverageDecisionInput) {
  return authenticatedApiRequest<{ coverage: AbsenceCoverageView | null }>(base(requestId), {
    method: 'POST', getIdToken: token(user), json: input, fallbackError: 'Não foi possível salvar a cobertura.',
  });
}
