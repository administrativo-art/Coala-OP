import type {
  CandidateDecisionAction,
  CandidateStageHistoryEntry,
  CandidateStatus,
  RecruitmentStage,
} from '@/types';

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  'applied',
  'screening',
  'interview',
  'technical_test',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
  'talent_pool',
];

export const RECRUITMENT_PIPELINE_STATUSES: CandidateStatus[] = [
  'applied',
  'screening',
  'interview',
  'technical_test',
  'offer',
  'hired',
];

export const DEFAULT_RECRUITMENT_STAGES: RecruitmentStage[] = [
  { id: 'applied', label: 'Inscrição', order: 0, required: true, dueDays: 7 },
  { id: 'screening', label: 'Triagem', order: 1, required: true, dueDays: 2 },
  { id: 'interview', label: 'Entrevista', order: 2, required: true, dueDays: 3 },
  { id: 'technical_test', label: 'Avaliação prática', order: 3, required: false, dueDays: 3 },
  { id: 'offer', label: 'Proposta', order: 4, required: false, dueDays: 2 },
  { id: 'hired', label: 'Contratação', order: 5, required: true, dueDays: null },
];

const DECISION_ACTIONS: CandidateDecisionAction[] = [
  'created',
  'advanced',
  'status_changed',
  'hired',
  'rejected',
  'withdrawn',
  'talent_pool',
];

export function isCandidateStatus(value: unknown): value is CandidateStatus {
  return typeof value === 'string' && CANDIDATE_STATUSES.includes(value as CandidateStatus);
}

export function isCandidateDecisionAction(value: unknown): value is CandidateDecisionAction {
  return typeof value === 'string' && DECISION_ACTIONS.includes(value as CandidateDecisionAction);
}

function cleanStageLabel(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : fallback;
}

function cleanDueDays(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

export function normalizeRecruitmentStages(value: unknown): RecruitmentStage[] {
  const defaultsById = new Map(DEFAULT_RECRUITMENT_STAGES.map(stage => [stage.id, stage]));
  const rawStages = Array.isArray(value) ? value : [];
  const normalized = rawStages
    .map((item): RecruitmentStage | null => {
      if (!item || typeof item !== 'object') return null;
      const data = item as Record<string, unknown>;
      if (!isCandidateStatus(data.id) || !RECRUITMENT_PIPELINE_STATUSES.includes(data.id)) return null;

      const fallback = defaultsById.get(data.id);
      return {
        id: data.id,
        label: cleanStageLabel(data.label, fallback?.label ?? data.id),
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : fallback?.order ?? 0,
        required: data.required === undefined ? fallback?.required ?? false : data.required === true,
        dueDays: cleanDueDays(data.dueDays),
      };
    })
    .filter((stage): stage is RecruitmentStage => stage !== null);

  const merged = RECRUITMENT_PIPELINE_STATUSES.map((status) => {
    const existing = normalized.find(stage => stage.id === status);
    const fallback = defaultsById.get(status)!;
    return existing ? { ...fallback, ...existing } : fallback;
  });

  return merged
    .sort((a, b) => a.order - b.order)
    .map((stage, index) => ({ ...stage, order: index }));
}

export function inferCandidateDecisionAction(
  fromStatus: CandidateStatus | null,
  toStatus: CandidateStatus
): CandidateDecisionAction {
  if (!fromStatus) return 'created';
  if (toStatus === 'hired') return 'hired';
  if (toStatus === 'rejected') return 'rejected';
  if (toStatus === 'withdrawn') return 'withdrawn';
  if (toStatus === 'talent_pool') return 'talent_pool';

  const fromIndex = RECRUITMENT_PIPELINE_STATUSES.indexOf(fromStatus);
  const toIndex = RECRUITMENT_PIPELINE_STATUSES.indexOf(toStatus);
  if (fromIndex >= 0 && toIndex > fromIndex) return 'advanced';
  return 'status_changed';
}

export function createCandidateStageHistoryEntry(params: {
  fromStatus?: CandidateStatus | null;
  toStatus: CandidateStatus;
  action?: CandidateDecisionAction | null;
  note?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  createdAt: string;
}): CandidateStageHistoryEntry {
  return {
    id: `${params.createdAt}_${params.toStatus}_${Math.random().toString(36).slice(2, 8)}`,
    fromStatus: params.fromStatus ?? null,
    toStatus: params.toStatus,
    action: params.action ?? inferCandidateDecisionAction(params.fromStatus ?? null, params.toStatus),
    note: params.note?.trim() ? params.note.trim().slice(0, 1000) : null,
    actorId: params.actorId ?? null,
    actorEmail: params.actorEmail ?? null,
    createdAt: params.createdAt,
  };
}

export function applicationStatusForCandidateStatus(status: CandidateStatus) {
  if (status === 'hired') return 'hired';
  if (status === 'rejected') return 'rejected';
  if (status === 'withdrawn') return 'withdrawn';
  if (status === 'talent_pool') return 'talent_pool';
  return 'active';
}
