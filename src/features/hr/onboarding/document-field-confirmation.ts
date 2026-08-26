import type { OnboardingDocument } from '@/types';

export type ConfirmDocumentFieldResult =
  | { ok: true; documents: OnboardingDocument[] }
  | { ok: false; reason: 'document_not_found' | 'field_not_found' };

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
