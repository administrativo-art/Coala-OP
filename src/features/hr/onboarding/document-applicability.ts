import type { OnboardingDocument } from '@/types';

export type FamilyDocumentKind = 'birth_certificate' | 'vaccination' | 'school_attendance';

type PresentableOnboardingDocument = {
  id: string;
  label: string;
  description?: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dependentAge(birthDate: string, today: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

export function requiredFamilyDocumentKinds(birthDate: string, today = new Date()): FamilyDocumentKind[] {
  const age = dependentAge(birthDate, today);
  if (age == null || age < 0 || age >= 14) return [];
  if (age < 4) return ['birth_certificate', 'vaccination'];
  if (age < 7) return ['birth_certificate', 'vaccination', 'school_attendance'];
  return ['birth_certificate', 'school_attendance'];
}

export function onboardingDocumentIsApplicable(
  document: Pick<OnboardingDocument, 'id'>,
  publicFormAnswers: unknown,
  today = new Date(),
) {
  const answers = record(publicFormAnswers);

  if (document.id === 'cnh') {
    if (answers.hasCnh === 'no') return false;
    if (answers.hasCnh === 'yes' && answers.identityDocumentType === 'cnh') return false;
    return true;
  }

  const childMatch = document.id.match(/^child_(\d+)_(birth_certificate|vaccination|school_attendance)$/);
  if (!childMatch) return true;
  if (answers.hasChildren === 'no') return false;
  if (!Array.isArray(answers.children)) return true;

  const child = record(answers.children[Number(childMatch[1]) - 1]);
  if (!Object.keys(child).length) return false;
  return requiredFamilyDocumentKinds(
    typeof child.birthDate === 'string' ? child.birthDate : '',
    today,
  ).includes(childMatch[2] as FamilyDocumentKind);
}

export function applicableOnboardingDocuments<T extends Pick<OnboardingDocument, 'id'>>(
  documents: T[],
  publicFormAnswers: unknown,
  today = new Date(),
) {
  return documents.filter(document => onboardingDocumentIsApplicable(document, publicFormAnswers, today));
}

export function presentOnboardingDocumentForAnswers<T extends PresentableOnboardingDocument>(
  document: T,
  publicFormAnswers: unknown,
): T {
  if (document.id !== 'identity_document') return document;
  const answers = record(publicFormAnswers);
  if (answers.hasCnh === 'yes') {
    return {
      ...document,
      label: 'CNH',
      description: 'Envie sua Carteira Nacional de Habilitação.',
    };
  }
  if (answers.hasCnh === 'no') {
    return {
      ...document,
      label: 'Documento de identidade (RG ou CIN)',
      description: 'Envie seu RG ou CIN. O sistema extrairá os dados de identificação que estiverem visíveis.',
    };
  }
  return document;
}
