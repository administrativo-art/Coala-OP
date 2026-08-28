import type { OnboardingDocument } from '@/types';

export type OnboardingDocumentAiResultInput = {
  provider: 'openai' | 'local_fallback';
  model: string;
  documentTypeCode: string;
  documentTypeConfidence: number;
  employeeMatchStatus: 'MATCH' | 'POSSIBLE_MATCH' | 'MISMATCH' | 'UNKNOWN';
  identifiedEmployeeName?: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  structure: {
    legibility: 'GOOD' | 'PARTIAL' | 'POOR';
    multipleDocumentsDetected: boolean;
    pageCount?: number | null;
  };
  issues: string[];
  warnings: string[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUsd?: number | null;
  promptVersion: string;
  schemaVersion: string;
};

export type OnboardingDocumentExtractionRecord = {
  sourceFileHashSha256: string;
  documentId: string;
  expectedDocumentTypeCode: string | null;
  reviewStatus: 'ai_approved' | 'review_required';
  extractedFields: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  aiAnalysis: NonNullable<OnboardingDocument['aiAnalysis']>;
  createdAt: string;
  updatedAt: string;
};

function cleanDocumentId(documentId: string) {
  return documentId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function onboardingDocumentExtractionCacheId(documentId: string, sha256: string) {
  const cleanHash = /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : 'invalid-hash';
  return `${cleanDocumentId(documentId)}_${cleanHash}`;
}

export function inferredOnboardingDocumentTypeCode(documentId: string) {
  if (/^child_\d+_birth_certificate$/.test(documentId)) return 'DEPENDENT_DOCUMENT';
  if (/^child_\d+_vaccination$/.test(documentId)) return 'VACCINATION_RECORD';
  if (/^child_\d+_school_attendance$/.test(documentId)) return 'SCHOOL_ATTENDANCE';
  return null;
}

function cleanStringArray(value: string[]) {
  return value.map(item => item.trim().slice(0, 220)).filter(Boolean).slice(0, 8);
}

export function buildOnboardingDocumentExtractionRecord(params: {
  documentId: string;
  sourceFileHashSha256: string;
  expectedDocumentTypeCode?: string | null;
  result: OnboardingDocumentAiResultInput;
  analyzedAt: string;
  durationMs: number;
}): OnboardingDocumentExtractionRecord {
  const expectedDocumentTypeCode = params.expectedDocumentTypeCode || null;
  const result = params.result;
  const issues = cleanStringArray(result.issues);
  const warnings = cleanStringArray(result.warnings);
  const typeMatches = !expectedDocumentTypeCode || result.documentTypeCode === expectedDocumentTypeCode;
  const safelyPreApproved = result.provider === 'openai'
    && typeMatches
    && result.documentTypeConfidence >= 0.85
    && result.structure.legibility === 'GOOD'
    && result.structure.multipleDocumentsDetected !== true
    && result.employeeMatchStatus !== 'MISMATCH'
    && issues.length === 0;

  return {
    sourceFileHashSha256: params.sourceFileHashSha256.toLowerCase(),
    documentId: cleanDocumentId(params.documentId),
    expectedDocumentTypeCode,
    reviewStatus: safelyPreApproved ? 'ai_approved' : 'review_required',
    extractedFields: result.extractedFields,
    fieldConfidences: result.fieldConfidences,
    aiAnalysis: {
      status: result.provider === 'openai' ? 'completed' : 'fallback',
      provider: result.provider,
      model: result.model,
      sourceFileHashSha256: params.sourceFileHashSha256.toLowerCase(),
      expectedDocumentTypeCode,
      detectedDocumentTypeCode: result.documentTypeCode,
      documentTypeConfidence: result.documentTypeConfidence,
      employeeMatchStatus: result.employeeMatchStatus,
      identifiedEmployeeName: result.identifiedEmployeeName ?? null,
      legibility: result.structure.legibility,
      multipleDocumentsDetected: result.structure.multipleDocumentsDetected,
      pageCount: result.structure.pageCount ?? null,
      issues,
      warnings: [
        ...(!typeMatches && expectedDocumentTypeCode
          ? [`O arquivo foi identificado como ${result.documentTypeCode}, mas era esperado ${expectedDocumentTypeCode}.`]
          : []),
        ...warnings,
      ].slice(0, 8),
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      promptVersion: result.promptVersion,
      schemaVersion: result.schemaVersion,
      analyzedAt: params.analyzedAt,
      durationMs: Math.max(0, Math.round(params.durationMs)),
    },
    createdAt: params.analyzedAt,
    updatedAt: params.analyzedAt,
  };
}

export function mergeOnboardingDocumentExtraction(params: {
  document: OnboardingDocument;
  sourceFileHashSha256: string;
  extraction?: OnboardingDocumentExtractionRecord | null;
}): Pick<OnboardingDocument,
  | 'status'
  | 'extractedFields'
  | 'fieldConfidences'
  | 'confirmedExtractedFields'
  | 'extractedFieldsConfirmedAt'
  | 'extractedFieldsConfirmedBy'
  | 'correctedExtractedFields'
  | 'extractedFieldsCorrectedAt'
  | 'extractedFieldsCorrectedBy'
  | 'aiAnalysis'
> {
  const extraction = params.extraction;
  const sourceHash = params.sourceFileHashSha256.toLowerCase();
  const samePreviouslyAnalyzedFile = params.document.fileHashSha256 === sourceHash
    && params.document.aiAnalysis?.sourceFileHashSha256 === sourceHash;

  if (!extraction || extraction.sourceFileHashSha256 !== sourceHash) {
    return samePreviouslyAnalyzedFile
      ? {
          status: params.document.status,
          extractedFields: params.document.extractedFields ?? {},
          fieldConfidences: params.document.fieldConfidences ?? {},
          confirmedExtractedFields: params.document.confirmedExtractedFields ?? [],
          extractedFieldsConfirmedAt: params.document.extractedFieldsConfirmedAt ?? null,
          extractedFieldsConfirmedBy: params.document.extractedFieldsConfirmedBy ?? null,
          correctedExtractedFields: params.document.correctedExtractedFields ?? [],
          extractedFieldsCorrectedAt: params.document.extractedFieldsCorrectedAt ?? null,
          extractedFieldsCorrectedBy: params.document.extractedFieldsCorrectedBy ?? null,
          aiAnalysis: params.document.aiAnalysis,
        }
      : {
          status: 'received',
          extractedFields: {},
          fieldConfidences: {},
          confirmedExtractedFields: [],
          extractedFieldsConfirmedAt: null,
          extractedFieldsConfirmedBy: null,
          correctedExtractedFields: [],
          extractedFieldsCorrectedAt: null,
          extractedFieldsCorrectedBy: null,
          aiAnalysis: undefined,
        };
  }

  return {
    status: extraction.reviewStatus,
    extractedFields: extraction.extractedFields,
    fieldConfidences: extraction.fieldConfidences,
    confirmedExtractedFields: [],
    extractedFieldsConfirmedAt: null,
    extractedFieldsConfirmedBy: null,
    correctedExtractedFields: [],
    extractedFieldsCorrectedAt: null,
    extractedFieldsCorrectedBy: null,
    aiAnalysis: extraction.aiAnalysis,
  };
}
