import type { OnboardingDocument } from '@/types';
import {
  dependentAge,
  familyRequiredDocs,
  type FamilyDocumentLabel,
} from '@/features/hr/lib/family-salary';

export const FAMILY_SALARY_LIMIT_2026 = 1_980.38;
export const FAMILY_SALARY_QUOTA_2026 = 67.54;

export type AccountantDependentAnalysis = {
  name: string;
  birthDate: string;
  ageLabel: string;
  documentDetails: string;
  eligibility: string;
};

const FAMILY_DOCUMENT_NAMES: Record<FamilyDocumentLabel, string> = {
  'certidão': 'Certidão de nascimento',
  'vacinação': 'Caderneta de vacinação',
  'frequência escolar': 'Comprovante de frequência escolar',
};

const FAMILY_DOCUMENT_IDS: Record<FamilyDocumentLabel, string> = {
  'certidão': 'birth_certificate',
  'vacinação': 'vaccination',
  'frequência escolar': 'school_attendance',
};

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateBr(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function familyDocumentId(childIndex: number, kind: FamilyDocumentLabel) {
  return `child_${childIndex + 1}_${FAMILY_DOCUMENT_IDS[kind]}`;
}

export function buildAccountantDependentAnalysis(input: {
  answers: Record<string, unknown>;
  documents: OnboardingDocument[];
  monthlySalary: number | null;
  today?: Date;
}) {
  const children = Array.isArray(input.answers.children)
    ? input.answers.children.map(record)
    : [];
  const today = input.today ?? new Date();
  let eligible = 0;
  let pending = 0;

  const dependents: AccountantDependentAnalysis[] = children.map((child, index) => {
    const birthDate = text(child.birthDate, 10);
    const age = dependentAge(birthDate || null, today);
    const required = familyRequiredDocs(birthDate || null, today);
    const approved = required.filter((kind) => input.documents.some((document) => (
      document.id === familyDocumentId(index, kind)
      && document.status === 'approved'
      && Boolean(document.filePath?.trim())
    )));
    const documentsComplete = required.length === approved.length;
    const ageEligible = age != null && age >= 0 && age < 14;
    const incomeEligible = input.monthlySalary != null && input.monthlySalary <= FAMILY_SALARY_LIMIT_2026;
    let eligibility = 'Não elegível pela idade';
    if (ageEligible && !documentsComplete) {
      eligibility = 'Pendente de documentação';
      pending += 1;
    } else if (ageEligible && input.monthlySalary == null) {
      eligibility = 'Aguardando remuneração';
      pending += 1;
    } else if (ageEligible && !incomeEligible) {
      eligibility = 'Não elegível pela renda';
    } else if (ageEligible) {
      eligibility = 'Elegível';
      eligible += 1;
    }

    return {
      name: text(child.name, 160) || `Dependente ${index + 1}`,
      birthDate: birthDate ? dateBr(birthDate) : 'Não informada',
      ageLabel: age == null ? 'Pendente' : `${age} ano${age === 1 ? '' : 's'}`,
      documentDetails: required.length === 0
        ? 'Nenhum documento exigido pela idade'
        : required
          .map((kind) => `${FAMILY_DOCUMENT_NAMES[kind]}: ${approved.includes(kind) ? 'aprovado' : 'pendente'}`)
          .join('\n'),
      eligibility,
    };
  });

  const conclusion = input.monthlySalary == null
    ? 'ANÁLISE PENDENTE: REMUNERAÇÃO NÃO INFORMADA'
    : input.monthlySalary > FAMILY_SALARY_LIMIT_2026
      ? 'NÃO ELEGÍVEL PELO CRITÉRIO DE RENDA'
      : eligible > 0
        ? `ELEGÍVEL: ${eligible} DEPENDENTE${eligible === 1 ? '' : 'S'} VALIDADO${eligible === 1 ? '' : 'S'}`
        : pending > 0
          ? 'AGUARDANDO VALIDAÇÃO DOS DEPENDENTES'
          : 'SEM DEPENDENTES ELEGÍVEIS';

  return { dependents, conclusion };
}
