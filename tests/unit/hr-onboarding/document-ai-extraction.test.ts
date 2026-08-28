import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOnboardingDocumentExtractionRecord,
  inferredOnboardingDocumentTypeCode,
  mergeOnboardingDocumentExtraction,
  onboardingDocumentExtractionCacheId,
} from '@/features/hr/onboarding/document-ai-extraction';
import type { OnboardingDocument } from '@/types';

const baseResult = {
  provider: 'openai' as const,
  model: 'gpt-5.6-terra',
  documentTypeCode: 'PERSONAL_ID',
  documentTypeConfidence: 0.96,
  employeeMatchStatus: 'MATCH' as const,
  identifiedEmployeeName: 'Pessoa Teste',
  extractedFields: { cpf: '12345678900', birthDate: '2000-01-01' },
  fieldConfidences: { cpf: 0.98, birthDate: 0.91 },
  structure: { legibility: 'GOOD' as const, multipleDocumentsDetected: false, pageCount: 1 },
  issues: [],
  warnings: [],
  inputTokens: 2500,
  outputTokens: 400,
  estimatedCostUsd: 0.0098,
  promptVersion: 'v5',
  schemaVersion: 'v5',
};

test('gera chave de cache determinística pelo documento e hash', () => {
  const hash = 'a'.repeat(64);
  assert.equal(onboardingDocumentExtractionCacheId('identity_document', hash), `identity_document_${hash}`);
});

test('infere os tipos dos documentos dinâmicos dos filhos', () => {
  assert.equal(inferredOnboardingDocumentTypeCode('child_1_birth_certificate'), 'DEPENDENT_DOCUMENT');
  assert.equal(inferredOnboardingDocumentTypeCode('child_2_vaccination'), 'VACCINATION_RECORD');
  assert.equal(inferredOnboardingDocumentTypeCode('child_3_school_attendance'), 'SCHOOL_ATTENDANCE');
});

test('pré-aprova somente análise segura e ainda exige decisão final do RH', () => {
  const hash = 'b'.repeat(64);
  const extraction = buildOnboardingDocumentExtractionRecord({
    documentId: 'identity_document',
    sourceFileHashSha256: hash,
    expectedDocumentTypeCode: 'PERSONAL_ID',
    result: baseResult,
    analyzedAt: '2026-08-25T12:00:00.000Z',
    durationMs: 1200,
  });
  assert.equal(extraction.reviewStatus, 'ai_approved');
  const merged = mergeOnboardingDocumentExtraction({
    document: { id: 'identity_document', label: 'Identidade', status: 'pending' } as OnboardingDocument,
    sourceFileHashSha256: hash,
    extraction,
  });
  assert.equal(merged.status, 'ai_approved');
  assert.equal(merged.extractedFields?.cpf, '12345678900');
  assert.deepEqual(merged.confirmedExtractedFields, []);
});

test('divergência de tipo exige revisão e é explicada', () => {
  const extraction = buildOnboardingDocumentExtractionRecord({
    documentId: 'ctps',
    sourceFileHashSha256: 'c'.repeat(64),
    expectedDocumentTypeCode: 'WORK_CARD',
    result: baseResult,
    analyzedAt: '2026-08-25T12:00:00.000Z',
    durationMs: 900,
  });
  assert.equal(extraction.reviewStatus, 'review_required');
  assert.match(extraction.aiAnalysis.warnings?.[0] ?? '', /era esperado WORK_CARD/);
});
