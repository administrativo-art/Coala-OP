import type {
  OnboardingDocument,
  OnboardingDocumentTemplate,
  OnboardingStage,
  OnboardingStageId,
} from '@/types';

export const ONBOARDING_STAGE_IDS: OnboardingStageId[] = [
  'documents',
  'document_review',
  'contract',
  'system_access',
  'integration',
  'probation',
  'done',
];

export const DEFAULT_ONBOARDING_STAGES: OnboardingStage[] = [
  { id: 'documents', label: 'Solicitação de documentos', order: 0, required: true, dueDays: 3 },
  { id: 'document_review', label: 'Conferência de documentos', order: 1, required: true, dueDays: 2 },
  { id: 'contract', label: 'Contrato e assinatura', order: 2, required: true, dueDays: 2 },
  { id: 'system_access', label: 'Criação de usuário', order: 3, required: true, dueDays: 1 },
  { id: 'integration', label: 'Integrações e códigos', order: 4, required: true, dueDays: null },
  { id: 'probation', label: 'Período de experiência', order: 5, required: true, dueDays: 90 },
  { id: 'done', label: 'Finalizado', order: 6, required: true, dueDays: null },
];

export const DEFAULT_ONBOARDING_DOCUMENTS: OnboardingDocumentTemplate[] = [
  { id: 'cpf', label: 'CPF', required: true, order: 0 },
  { id: 'rg', label: 'RG', required: true, order: 1 },
  { id: 'ctps', label: 'CTPS', required: true, order: 2 },
  { id: 'pis', label: 'PIS', required: true, order: 3 },
  { id: 'address_proof', label: 'Comprovante de residência', required: true, order: 4 },
  { id: 'bank_data', label: 'Dados bancários', required: true, order: 5 },
  { id: 'aso_admission', label: 'ASO admissional', required: true, order: 6 },
];

function cleanLabel(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 100)
    : fallback;
}

function cleanDueDays(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function isOnboardingStageId(value: unknown): value is OnboardingStageId {
  return typeof value === 'string' && ONBOARDING_STAGE_IDS.includes(value as OnboardingStageId);
}

function modelStageIds(value: unknown) {
  const ids = new Set<OnboardingStageId>();
  if (!Array.isArray(value)) return ids;
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = (entry as Record<string, unknown>).id;
    if (isOnboardingStageId(id)) ids.add(id);
  });
  return ids;
}

export function normalizeOnboardingStages(value: unknown): OnboardingStage[] {
  const defaultsById = new Map(DEFAULT_ONBOARDING_STAGES.map(stage => [stage.id, stage]));
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map((entry): OnboardingStage | null => {
      if (!entry || typeof entry !== 'object') return null;
      const data = entry as Record<string, unknown>;
      if (!isOnboardingStageId(data.id)) return null;
      const fallback = defaultsById.get(data.id);
      return {
        id: data.id,
        label: cleanLabel(data.label, fallback?.label ?? data.id),
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : fallback?.order ?? 0,
        required: data.required === undefined ? fallback?.required ?? false : data.required === true,
        dueDays: cleanDueDays(data.dueDays),
      };
    })
    .filter((stage): stage is OnboardingStage => stage !== null);

  return ONBOARDING_STAGE_IDS.map((id) => {
    const fallback = defaultsById.get(id)!;
    const existing = normalized.find(stage => stage.id === id);
    return existing ? { ...fallback, ...existing } : fallback;
  })
    .sort((a, b) => a.order - b.order)
    .map((stage, index) => ({ ...stage, order: index }));
}

export function mergeOnboardingStageModels(roleStages: unknown, functionStages?: unknown) {
  const functionIds = modelStageIds(functionStages);
  const base = modelStageIds(roleStages).size > 0
    ? normalizeOnboardingStages(roleStages)
    : normalizeOnboardingStages(null);

  if (functionIds.size === 0) return base;
  const functionModel = normalizeOnboardingStages(functionStages);
  if (functionIds.size >= ONBOARDING_STAGE_IDS.length) return functionModel;

  const functionById = new Map(functionModel.map(stage => [stage.id, stage]));
  return normalizeOnboardingStages(base.map(stage =>
    functionIds.has(stage.id) ? { ...stage, ...functionById.get(stage.id) } : stage
  ));
}

export function normalizeOnboardingDocumentTemplates(value: unknown): OnboardingDocumentTemplate[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized = raw
    .map((entry, index): OnboardingDocumentTemplate | null => {
      if (!entry || typeof entry !== 'object') return null;
      const data = entry as Record<string, unknown>;
      const id = typeof data.id === 'string' && data.id.trim()
        ? data.id.trim().slice(0, 80)
        : typeof data.label === 'string' && data.label.trim()
          ? data.label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80)
          : '';
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: cleanLabel(data.label, id),
        required: data.required !== false,
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : index,
      };
    })
    .filter((doc): doc is OnboardingDocumentTemplate => doc !== null);

  return normalized
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((doc, index) => ({ ...doc, order: index }));
}

export function mergeOnboardingDocumentModels(
  roleDocuments: unknown,
  functionDocuments?: unknown
) {
  const merged = normalizeOnboardingDocumentTemplates(
    Array.isArray(roleDocuments) && roleDocuments.length > 0
      ? roleDocuments
      : DEFAULT_ONBOARDING_DOCUMENTS
  );
  const functionDocs = normalizeOnboardingDocumentTemplates(functionDocuments);

  for (const doc of functionDocs) {
    const existingIndex = merged.findIndex(item => item.id === doc.id);
    if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...doc };
    else merged.push(doc);
  }

  return normalizeOnboardingDocumentTemplates(merged);
}

export function instantiateOnboardingDocuments(
  templates: OnboardingDocumentTemplate[],
  existing?: OnboardingDocument[]
): OnboardingDocument[] {
  const existingById = new Map((existing ?? []).map(doc => [doc.id, doc]));
  return templates.map((template, index) => ({
    ...template,
    order: index,
    status: existingById.get(template.id)?.status ?? 'pending',
    fileUrl: existingById.get(template.id)?.fileUrl ?? null,
    filePath: existingById.get(template.id)?.filePath ?? null,
    receivedAt: existingById.get(template.id)?.receivedAt ?? null,
    approvedAt: existingById.get(template.id)?.approvedAt ?? null,
    updatedAt: existingById.get(template.id)?.updatedAt ?? null,
    note: existingById.get(template.id)?.note ?? null,
  }));
}
