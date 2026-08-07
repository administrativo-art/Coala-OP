import type {
  OnboardingDocument,
  OnboardingDocumentTemplate,
  OnboardingStage,
  OnboardingStageId,
} from '@/types';

// 'probation' foi removido desta lista: o período de experiência não é mais uma etapa
// sequencial de currentStage (nenhum código transiciona para ela — o botão "Finalizar
// integração" sempre pula de 'integration' direto para 'done'). O acompanhamento real dos
// 90 dias é feito pelo motor independente `probationV2` (ver probation-process.ts), exibido
// no grupo "Experiência" da tela, sem depender desta lista.
export const ONBOARDING_STAGE_IDS: OnboardingStageId[] = [
  'documents',
  'document_review',
  'accountant',
  'signature_preparation',
  'signature',
  'formalization_validation',
  'integration',
  'done',
];

export const DEFAULT_ONBOARDING_STAGES: OnboardingStage[] = [
  { id: 'documents', label: 'Coleta de dados e documentos', order: 0, required: true, dueDays: 3 },
  { id: 'document_review', label: 'Revisão da coleta', order: 1, required: true, dueDays: 2 },
  { id: 'accountant', label: 'Formalização · Contador', order: 2, required: true, dueDays: 3 },
  { id: 'signature_preparation', label: 'Geração e revisão para assinatura', order: 3, required: true, dueDays: null },
  { id: 'signature', label: 'Assinatura dos documentos', order: 4, required: true, dueDays: null },
  { id: 'formalization_validation', label: 'Validação da formalização', order: 5, required: true, dueDays: null },
  { id: 'integration', label: 'Criação de usuário e integrações', order: 6, required: true, dueDays: null },
  { id: 'done', label: 'Finalizado', order: 7, required: true, dueDays: null },
];

export const PJ_ONBOARDING_STAGES: OnboardingStage[] = [
  { id: 'documents', label: 'Cadastro da empresa prestadora', order: 0, required: true, dueDays: 3 },
  { id: 'document_review', label: 'Conferência cadastral pelo RH', order: 1, required: true, dueDays: 2 },
  { id: 'signature_preparation', label: 'Preparação e revisão do contrato', order: 2, required: true, dueDays: null },
  { id: 'signature', label: 'Assinaturas do contrato', order: 3, required: true, dueDays: null },
  { id: 'formalization_validation', label: 'Cadastro financeiro e fiscal', order: 4, required: true, dueDays: null },
  { id: 'integration', label: 'Configuração de acessos', order: 5, required: true, dueDays: null },
  { id: 'done', label: 'Prestadora ativada', order: 6, required: true, dueDays: null },
];

export const DEFAULT_ONBOARDING_DOCUMENTS: OnboardingDocumentTemplate[] = [
  {
    id: 'identity_document',
    label: 'Documento de identidade ou CNH',
    documentTypeCode: 'PERSONAL_ID',
    description: 'Envie RG/CIN ou CNH. O sistema extrai CPF, data de nascimento e filiação quando esses dados estiverem visíveis.',
    required: true,
    order: 0,
  },
  {
    id: 'profile_photo',
    label: 'Foto para identificação',
    documentTypeCode: 'PROFILE_PHOTO',
    description: 'Envie uma foto atual, nítida, de frente, com o rosto descoberto e fundo neutro. São aceitos JPG e PNG.',
    required: true,
    order: 1,
  },
  {
    id: 'ctps',
    label: 'Carteira de Trabalho (CTPS)',
    documentTypeCode: 'WORK_CARD',
    description: 'Se for digital, envie o comprovante/PDF gerado no app Carteira de Trabalho Digital. Se for física, envie a página da foto e o verso com os dados pessoais.',
    required: true,
    order: 2,
  },
  {
    id: 'pis',
    label: 'Comprovante do PIS/PASEP',
    documentTypeCode: 'PIS_PASEP',
    description: 'Pode ser comprovante do app Carteira de Trabalho Digital, Meu INSS/CNIS, Caixa Trabalhador ou outro documento oficial que mostre o número.',
    required: true,
    order: 3,
  },
  {
    id: 'address_proof',
    label: 'Comprovante de residência completo',
    documentTypeCode: 'ADDRESS_PROOF',
    description: 'Envie o comprovante completo, com endereço, cidade, UF e CEP visíveis.',
    required: true,
    order: 4,
  },
  {
    id: 'civil_certificate',
    label: 'Certidão de nascimento ou casamento',
    documentTypeCode: 'CIVIL_CERTIFICATE',
    description: 'Envie certidão de nascimento se for solteiro(a), ou certidão de casamento se for casado(a).',
    required: true,
    order: 5,
  },
  {
    id: 'cnh',
    label: 'CNH',
    documentTypeCode: 'PERSONAL_ID',
    description: 'Obrigatória somente se você possui CNH e não usou a CNH como documento de identificação.',
    required: false,
    order: 6,
  },
];

export const PJ_ONBOARDING_DOCUMENTS: OnboardingDocumentTemplate[] = [
  {
    id: 'company_formation_document',
    label: 'Contrato social, requerimento de empresário ou CCMEI',
    documentTypeCode: 'PJ_FORMATION_DOCUMENT',
    description: 'Envie o documento constitutivo vigente da empresa prestadora.',
    required: true,
    order: 0,
  },
  {
    id: 'legal_representative_document',
    label: 'Documento do representante legal',
    documentTypeCode: 'PJ_REPRESENTATIVE_ID',
    description: 'Envie RG, CIN ou CNH do representante informado no cadastro.',
    required: true,
    order: 1,
  },
  {
    id: 'bank_proof',
    label: 'Comprovante bancário da empresa',
    documentTypeCode: 'PJ_BANK_PROOF',
    description: 'O documento deve identificar a titularidade e os dados para pagamento.',
    required: true,
    order: 2,
  },
  {
    id: 'power_of_attorney',
    label: 'Procuração',
    documentTypeCode: 'PJ_POWER_OF_ATTORNEY',
    description: 'Envie somente quando a assinatura não decorrer diretamente do contrato social.',
    required: false,
    order: 3,
  },
];

function cleanLabel(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 100)
    : fallback;
}

function cleanDescription(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : undefined;
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

export function applyOnboardingSignatureMode(stages: OnboardingStage[], generateSignatureDocuments: boolean) {
  const filtered = generateSignatureDocuments
    ? stages
    : stages.filter(stage => stage.id !== 'signature_preparation' && stage.id !== 'signature');

  return filtered
    .sort((a, b) => a.order - b.order)
    .map((stage, index) => ({ ...stage, order: index }));
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
        documentTypeCode: typeof data.documentTypeCode === 'string' && data.documentTypeCode.trim()
          ? data.documentTypeCode.trim().slice(0, 80)
          : undefined,
        description: cleanDescription(data.description),
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
  const merged = normalizeOnboardingDocumentTemplates(DEFAULT_ONBOARDING_DOCUMENTS);
  const roleDocs = normalizeOnboardingDocumentTemplates(roleDocuments);
  const functionDocs = normalizeOnboardingDocumentTemplates(functionDocuments);

  for (const doc of [...roleDocs, ...functionDocs]) {
    const existingIndex = merged.findIndex(item => item.id === doc.id);
    if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...doc };
    else merged.push(doc);
  }

  return normalizeOnboardingDocumentTemplates(merged)
    .filter(document => document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION')
    .map((document) => document.id === 'profile_photo'
      ? { ...document, documentTypeCode: 'PROFILE_PHOTO', required: true }
      : document);
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
    extractedFields: existingById.get(template.id)?.extractedFields ?? {},
    fieldConfidences: existingById.get(template.id)?.fieldConfidences ?? {},
    promotedDocumentId: existingById.get(template.id)?.promotedDocumentId ?? null,
    promotedAt: existingById.get(template.id)?.promotedAt ?? null,
    promotedBy: existingById.get(template.id)?.promotedBy ?? null,
  }));
}
