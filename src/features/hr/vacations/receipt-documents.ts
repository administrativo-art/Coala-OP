import type { DPVacationReceiptDocument, DPVacationWorkflow } from '@/types';

type Receipt = DPVacationWorkflow['receipt'];

export type VacationReceiptExpectedValues = {
  employeeName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
};

function normalizedName(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function vacationReceiptDocuments(receipt: Receipt): DPVacationReceiptDocument[] {
  const documents = Array.isArray(receipt.documents) ? receipt.documents.filter((document) => Boolean(document?.id)) : [];
  if (!receipt.originalDocumentId || documents.some((document) => document.id === receipt.originalDocumentId)) {
    return documents;
  }
  if (!receipt.originalStoragePath || !receipt.originalHashSha256 || !receipt.originalFileName || !receipt.originalMimeType) {
    return documents;
  }
  const selected = receipt.status !== 'correction_requested';
  return [
    ...documents,
    {
      id: receipt.originalDocumentId,
      fileName: receipt.originalFileName,
      mimeType: receipt.originalMimeType,
      storagePath: receipt.originalStoragePath,
      hashSha256: receipt.originalHashSha256,
      size: receipt.originalSize ?? 0,
      uploadedAt: receipt.originalUploadedAt ?? '',
      uploadedBy: receipt.originalUploadedBy ?? 'external:accountant',
      correctionRound: 0,
      status: selected ? 'selected' : 'superseded',
      analysis: receipt.analysis ?? null,
      analyzedAt: receipt.analysis?.analyzedAt ?? null,
    },
  ];
}

export function activeVacationReceiptDocuments(receipt: Receipt) {
  return vacationReceiptDocuments(receipt).filter((document) => document.status !== 'superseded');
}

export function vacationReceiptCandidateScore(
  document: DPVacationReceiptDocument,
  expected: VacationReceiptExpectedValues,
) {
  const analysis = document.analysis;
  if (!analysis) return -100;
  let score = analysis.documentTypeCode === 'VACATION_RECEIPT' ? 100 : 0;
  score += Math.round(analysis.documentTypeConfidence * 20);
  score += analysis.employeeMatchStatus === 'MATCH'
    ? 15
    : analysis.employeeMatchStatus === 'POSSIBLE_MATCH'
      ? 8
      : analysis.employeeMatchStatus === 'MISMATCH'
        ? -30
        : 0;
  const fields = analysis.extractedFields;
  if (expected.employeeName && fields.employeeName) {
    score += normalizedName(expected.employeeName) === normalizedName(fields.employeeName) ? 8 : -4;
  }
  if (expected.startDate && fields.vacationStartDate) {
    score += expected.startDate === fields.vacationStartDate ? 10 : -6;
  }
  if (expected.endDate && fields.vacationEndDate) {
    score += expected.endDate === fields.vacationEndDate ? 10 : -6;
  }
  if (expected.days != null && fields.numberOfDays != null) {
    score += Number(expected.days) === Number(fields.numberOfDays) ? 6 : -4;
  }
  score += [fields.amountGross, fields.amountDiscounts, fields.amountNet]
    .filter((value) => typeof value === 'number').length * 3;
  score += fields.signatureDetected === true ? 3 : fields.signatureDetected === false ? -2 : 0;
  score -= analysis.issues.length * 2;
  return score;
}

export function suggestVacationReceiptDocument(
  documents: DPVacationReceiptDocument[],
  expected: VacationReceiptExpectedValues,
) {
  return [...documents]
    .filter((document) => document.status !== 'superseded')
    .sort((left, right) => {
      const scoreDifference = vacationReceiptCandidateScore(right, expected) - vacationReceiptCandidateScore(left, expected);
      if (scoreDifference !== 0) return scoreDifference;
      return left.uploadedAt.localeCompare(right.uploadedAt) || left.id.localeCompare(right.id);
    })[0] ?? null;
}
