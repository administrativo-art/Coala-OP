import type { OnboardingDocument } from '@/types';

export type ConfirmDocumentFieldResult =
  | { ok: true; documents: OnboardingDocument[] }
  | { ok: false; reason: 'document_not_found' | 'field_not_found' };

export type CorrectDocumentFieldResult =
  | { ok: true; documents: OnboardingDocument[] }
  | { ok: false; reason: 'document_not_found' | 'field_not_found' | 'unsupported_value' | 'invalid_value' };

export function confirmExtractedDocumentField(params: {
  documents: OnboardingDocument[];
  documentId: string;
  fieldKey: string;
  now: string;
  actorId: string;
}): ConfirmDocumentFieldResult {
  const document = params.documents.find(item => item.id === params.documentId);
  if (!document) return { ok: false, reason: 'document_not_found' };
  if (!document.extractedFields || !(params.fieldKey in document.extractedFields)) {
    return { ok: false, reason: 'field_not_found' };
  }

  const confirmedExtractedFields = [...new Set([
    ...(document.confirmedExtractedFields ?? []),
    params.fieldKey,
  ])];
  return {
    ok: true,
    documents: params.documents.map(item => item.id === params.documentId ? {
      ...item,
      confirmedExtractedFields,
      extractedFieldsConfirmedAt: params.now,
      extractedFieldsConfirmedBy: params.actorId,
      updatedAt: params.now,
    } : item),
  };
}

function correctedValue(current: unknown, input: unknown): { ok: true; value: string | number | boolean } | { ok: false } {
  if (typeof current === 'number') {
    const value = typeof input === 'number' ? input : Number(String(input).replace(',', '.'));
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (typeof current === 'boolean') {
    if (input === true || input === 'true') return { ok: true, value: true };
    if (input === false || input === 'false') return { ok: true, value: false };
    return { ok: false };
  }
  if (current !== null && typeof current === 'object') return { ok: false };
  const value = typeof input === 'string' ? input.trim().slice(0, 500) : '';
  return value ? { ok: true, value } : { ok: false };
}

export function correctExtractedDocumentField(params: {
  documents: OnboardingDocument[];
  documentId: string;
  fieldKey: string;
  value: unknown;
  now: string;
  actorId: string;
}): CorrectDocumentFieldResult {
  const document = params.documents.find(item => item.id === params.documentId);
  if (!document) return { ok: false, reason: 'document_not_found' };
  if (!document.extractedFields || !(params.fieldKey in document.extractedFields)) {
    return { ok: false, reason: 'field_not_found' };
  }
  const current = document.extractedFields[params.fieldKey];
  if (current !== null && typeof current === 'object') return { ok: false, reason: 'unsupported_value' };
  const normalized = correctedValue(current, params.value);
  if (!normalized.ok) return { ok: false, reason: 'invalid_value' };

  const confirmedExtractedFields = [...new Set([
    ...(document.confirmedExtractedFields ?? []),
    params.fieldKey,
  ])];
  const correctedExtractedFields = [...new Set([
    ...(document.correctedExtractedFields ?? []),
    params.fieldKey,
  ])];
  return {
    ok: true,
    documents: params.documents.map(item => item.id === params.documentId ? {
      ...item,
      extractedFields: {
        ...item.extractedFields,
        [params.fieldKey]: normalized.value,
      },
      confirmedExtractedFields,
      extractedFieldsConfirmedAt: params.now,
      extractedFieldsConfirmedBy: params.actorId,
      correctedExtractedFields,
      extractedFieldsCorrectedAt: params.now,
      extractedFieldsCorrectedBy: params.actorId,
      updatedAt: params.now,
    } : item),
  };
}
