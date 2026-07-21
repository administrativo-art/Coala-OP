import { createHash, randomBytes } from 'node:crypto';

import type { OnboardingDocument } from '@/types';

export function createAccountantToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccountantToken(token) };
}

export function hashAccountantToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function accountantTokenExpiresAt(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function candidateDocumentsForAccountant(documents: OnboardingDocument[], selectedDocumentIds?: string[]) {
  const selectedIds = selectedDocumentIds ? new Set(selectedDocumentIds) : null;
  return documents.filter((document) => (
    document.status === 'approved'
    && document.id !== 'aso_admission'
    && document.documentTypeCode !== 'ASO_ADMISSION'
    && typeof document.filePath === 'string'
    && document.filePath.trim().length > 0
    && (!selectedIds || selectedIds.has(document.id))
  ));
}

export function missingAccountantPrerequisites(input: {
  documents: OnboardingDocument[];
  asoApproved: boolean;
  expectedAdmissionDate?: string | null;
}) {
  const missing: string[] = [];
  const requiredCandidateDocuments = input.documents.filter((document) => (
    document.required !== false
    && document.id !== 'aso_admission'
    && document.documentTypeCode !== 'ASO_ADMISSION'
  ));
  if (requiredCandidateDocuments.some((document) => document.status !== 'approved')) {
    missing.push('aprovação de todos os documentos obrigatórios do candidato');
  }
  if (requiredCandidateDocuments.some((document) => document.status === 'approved' && (!document.filePath || !document.filePath.trim()))) {
    missing.push('arquivo auditável dos documentos aprovados');
  }
  if (!input.asoApproved) missing.push('aprovação do ASO admissional');
  if (!input.expectedAdmissionDate) missing.push('data de admissão');
  return missing;
}

export function accountantAttachmentName(index: number, label: string, extension = 'pdf') {
  const clean = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 90) || 'Documento';
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  return `Anexo ${String(index).padStart(2, '0')} - ${clean}.${ext}`;
}
