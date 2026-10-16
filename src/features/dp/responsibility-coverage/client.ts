import type { User as FirebaseUser } from 'firebase/auth';

import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import type { DPAbsenceApprovalLevel, DPResponsibilityActivity, DPResponsibilityScope, DPResponsibilityTask } from '@/types';

const token = (user: FirebaseUser) => () => user.getIdToken();

export type ResponsibilityCoverageRow = {
  id: string;
  activity: DPResponsibilityActivity;
  scope: DPResponsibilityScope;
  scopeName: string;
  unitCount: number;
  levels: DPAbsenceApprovalLevel[];
  state: 'draft' | 'active';
  version: number;
  status: 'covered' | 'warning' | 'uncovered' | 'draft';
  effectiveLevel: number | null;
  eligibleUserIds: string[];
  diagnostics: Array<{ level: number; candidateCount: number; eligibleCount: number; inactiveCount: number;
    missingPermissionCount: number; missingScopeCount: number; fallbackUsed: boolean; eligibleUserIds: string[] }>;
  gapReason: 'not_configured' | 'draft' | 'empty_scope' | 'no_eligible_user' | null;
};

export function fetchResponsibilityCoverages(user: FirebaseUser, activity?: DPResponsibilityActivity) {
  const query = activity ? `?activity=${encodeURIComponent(activity)}` : '';
  return authenticatedApiRequest<{ coverages: ResponsibilityCoverageRow[] }>(`/api/dp/responsibility-coverages${query}`, {
    getIdToken: token(user), fallbackError: 'Não foi possível carregar as coberturas do DP.',
  });
}
export function saveResponsibilityCoverage(user: FirebaseUser, input: {
  activity: DPResponsibilityActivity;
  scope: DPResponsibilityScope;
  levels: DPAbsenceApprovalLevel[];
  state: 'draft' | 'active';
  expectedVersion: number;
  operationId: string;
}) {
  return authenticatedApiRequest<{ id: string; version: number }>('/api/dp/responsibility-coverages', {
    method: 'PUT', getIdToken: token(user), json: input, fallbackError: 'Não foi possível salvar a cobertura.',
  });
}
export function fetchResponsibilityTasks(user: FirebaseUser, options: {
  status?: DPResponsibilityTask['status']; activity?: DPResponsibilityActivity; cursor?: string;
} = {}) {
  const params = new URLSearchParams({ limit: '25' });
  Object.entries(options).forEach(([key, value]) => { if (value) params.set(key, value); });
  return authenticatedApiRequest<{ tasks: DPResponsibilityTask[]; nextCursor: string | null }>(`/api/dp/responsibility-tasks?${params}`, {
    getIdToken: token(user), fallbackError: 'Não foi possível carregar as pendências de cobertura.',
  });
}
export function actOnResponsibilityTask(user: FirebaseUser, taskId: string, input: {
  action: 'claim'; expectedVersion: number; operationId: string;
} | {
  action: 'resolve'; expectedVersion: number; operationId: string; note: string;
}) {
  return authenticatedApiRequest<{ task: DPResponsibilityTask }>(`/api/dp/responsibility-tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', getIdToken: token(user), json: input, fallbackError: 'Não foi possível atualizar a pendência.',
  });
}
