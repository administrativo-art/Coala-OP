import type { DPUnit, User } from '@/types';
import { CnpjValidator } from '@/lib/company/cnpj-validator';

import { isCivilDate, type EmploymentPeriod } from './resolve';
import type { EmploymentPeriodInput } from './schemas';

export type EmploymentHistoryResult =
  | { status: 'missing' }
  | { status: 'inconsistent'; historyId?: string; revision?: number }
  | { status: 'found'; historyId: string; revision: number; periods: EmploymentPeriod[] };

export type EmploymentPeriodDraft = EmploymentPeriodInput;

export type EmploymentPeriodSeed = {
  draft: EmploymentPeriodDraft;
  missingFields: string[];
};

export type TimelinePreparation =
  | { ok: false; message: string }
  | { ok: true; periods: EmploymentPeriodInput[]; closesPreviousAt: string | null };

const RELATIONSHIP_TYPES = ['clt', 'apprenticeship', 'pj', 'internship', 'partner'] as const;

export const employmentRelationshipLabels: Record<EmploymentPeriodInput['employmentRelationshipType'], string> = {
  clt: 'CLT',
  apprenticeship: 'Aprendizagem',
  pj: 'Pessoa jurídica',
  internship: 'Estágio',
  partner: 'Sócio(a)',
};

export function formatCivilDateBR(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Não informada';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function previousCivilDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

export function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function unitLabel(unitId: string, units: DPUnit[]): string {
  return units.find((unit) => unit.id === unitId)?.name ?? `Unidade ${unitId}`;
}

export function periodInput(period: EmploymentPeriod): EmploymentPeriodInput {
  return {
    validFrom: period.validFrom,
    ...(period.validTo ? { validTo: period.validTo } : {}),
    employmentRelationshipType: period.employmentRelationshipType,
    employerUnitId: period.employerUnitId,
    unitId: period.unitId,
    unitIds: [...period.unitIds],
    ...(period.jobRoleId ? { jobRoleId: period.jobRoleId } : {}),
    jobFunctionIds: [...period.jobFunctionIds],
    sourceDocumentId: period.sourceDocumentId,
    sourceReason: period.sourceReason,
  };
}

export function seedEmploymentPeriod(user: User): EmploymentPeriodSeed {
  const relationship = RELATIONSHIP_TYPES.includes(user.employmentRelationshipType as typeof RELATIONSHIP_TYPES[number])
    ? user.employmentRelationshipType as EmploymentPeriodInput['employmentRelationshipType']
    : 'clt';
  const missingFields: string[] = [];
  if (!user.employmentRelationshipType) missingFields.push('tipo de vínculo');
  if (!user.employerUnitId) missingFields.push('unidade empregadora');
  if (!user.unitId) missingFields.push('lotação principal');
  if (!Array.isArray(user.unitIds)) missingFields.push('unidades operacionais');
  if (!user.jobRoleId) missingFields.push('cargo');
  if (!Array.isArray(user.jobFunctionIds)) missingFields.push('funções');

  return {
    draft: {
      validFrom: '',
      employmentRelationshipType: relationship,
      employerUnitId: user.employerUnitId ?? '',
      unitId: user.unitId ?? '',
      unitIds: Array.isArray(user.unitIds) ? [...new Set(user.unitIds.filter(Boolean))] : [],
      ...(user.jobRoleId ? { jobRoleId: user.jobRoleId } : {}),
      jobFunctionIds: Array.isArray(user.jobFunctionIds) ? [...new Set(user.jobFunctionIds.filter(Boolean))] : [],
      sourceDocumentId: '',
      sourceReason: '',
    },
    missingFields,
  };
}

export function incompleteDraftFields(draft: EmploymentPeriodDraft, user: User): string[] {
  const missing: string[] = [];
  if (!user.employmentRelationshipType) missing.push('tipo de vínculo no cadastro atual');
  if (!user.jobRoleId) missing.push('cargo no cadastro atual');
  if (!Array.isArray(user.jobFunctionIds)) missing.push('funções no cadastro atual');
  if (!draft.employerUnitId) missing.push('unidade empregadora');
  if (!draft.unitId) missing.push('lotação principal');
  if (draft.unitIds.length === 0) missing.push('unidades operacionais');
  if (!draft.validFrom) missing.push('início da vigência');
  else if (!isCivilDate(draft.validFrom)) missing.push('início da vigência válido');
  if (!draft.sourceDocumentId.trim()) missing.push('código ou referência do documento-base');
  else if (!/^[A-Za-z0-9_-]{1,180}$/.test(draft.sourceDocumentId.trim())) missing.push('código ou referência do documento-base em formato válido');
  if (draft.sourceReason.trim().length < 5) missing.push('motivo com pelo menos 5 caracteres');
  return missing;
}

export function employerCatalogIssues(employerUnitId: string, units: DPUnit[]): string[] {
  if (!employerUnitId) return [];
  const employer = units.find((unit) => unit.id === employerUnitId);
  if (!employer) return ['unidade empregadora disponível no catálogo'];
  const issues: string[] = [];
  if (!employer.name?.trim()) issues.push('nome operacional da unidade empregadora');
  if (!CnpjValidator.validate(employer.cnpj ?? '').valid) issues.push('CNPJ válido da unidade empregadora');
  if (!employer.address?.trim()) issues.push('endereço da unidade empregadora');
  return issues;
}

export function prepareTimelinePublication(
  result: EmploymentHistoryResult,
  draft: EmploymentPeriodDraft,
): TimelinePreparation {
  if (result.status === 'inconsistent') {
    return { ok: false, message: 'O histórico está inconsistente e precisa ser revisto antes de uma nova publicação.' };
  }
  if (!isCivilDate(draft.validFrom)) {
    return { ok: false, message: 'Informe uma data civil válida para o início da nova vigência.' };
  }
  const prior = result.status === 'found' ? result.periods.map(periodInput) : [];
  const last = prior.at(-1);
  let closesPreviousAt: string | null = null;

  if (last) {
    if (draft.validFrom <= last.validFrom) {
      return { ok: false, message: 'A nova vigência precisa começar depois da última vigência publicada.' };
    }
    if (last.validTo && draft.validFrom <= last.validTo) {
      return { ok: false, message: `A nova vigência precisa começar depois de ${formatCivilDateBR(last.validTo)}.` };
    }
    if (!last.validTo) {
      closesPreviousAt = previousCivilDate(draft.validFrom);
      if (!closesPreviousAt || closesPreviousAt < last.validFrom) {
        return { ok: false, message: 'A data escolhida não permite encerrar a vigência anterior.' };
      }
      prior[prior.length - 1] = { ...last, validTo: closesPreviousAt };
    }
  }

  return {
    ok: true,
    periods: [...prior, {
      ...draft,
      sourceDocumentId: draft.sourceDocumentId.trim(),
      sourceReason: draft.sourceReason.trim(),
      unitIds: [...draft.unitIds],
      jobFunctionIds: [...draft.jobFunctionIds],
    }],
    closesPreviousAt,
  };
}

