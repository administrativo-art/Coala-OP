import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountantAttachmentName, candidateDocumentsForAccountant, createAccountantToken, hashAccountantToken, missingAccountantPrerequisites } from '../../../src/features/hr/accountant/workflow';
import { normalizeOnboardingStages } from '../../../src/lib/recruitment-onboarding';
import type { OnboardingDocument } from '../../../src/types';

const approvedDocument: OnboardingDocument = { id: 'identity', label: 'Documento de identificação', required: true, status: 'approved', filePath: 'hr/onboarding/id.pdf' };

test('etapa do contador fica entre conferência e preparação de assinatura', () => {
  const stages = normalizeOnboardingStages(null);
  assert.ok(stages.findIndex((stage) => stage.id === 'document_review') < stages.findIndex((stage) => stage.id === 'accountant'));
  assert.ok(stages.findIndex((stage) => stage.id === 'accountant') < stages.findIndex((stage) => stage.id === 'signature_preparation'));
});

test('pré-requisitos exigem documentos, ASO e data de admissão', () => {
  assert.deepEqual(missingAccountantPrerequisites({ documents: [approvedDocument], asoApproved: true, expectedAdmissionDate: '2026-07-25' }), []);
  assert.equal(missingAccountantPrerequisites({ documents: [{ ...approvedDocument, status: 'received' }], asoApproved: false, expectedAdmissionDate: null }).length, 3);
});

test('pacote inclui somente documentos aprovados com arquivo e exclui o ASO duplicado', () => {
  const selected = candidateDocumentsForAccountant([
    approvedDocument,
    { id: 'aso_admission', label: 'ASO', required: true, status: 'approved', filePath: 'aso.pdf', documentTypeCode: 'ASO_ADMISSION' },
    { id: 'pending', label: 'Pendente', required: false, status: 'received', filePath: 'pending.pdf' },
  ]);
  assert.deepEqual(selected.map((document) => document.id), ['identity']);
});

test('pacote respeita a seleção explícita feita pelo RH', () => {
  const selected = candidateDocumentsForAccountant([
    approvedDocument,
    { ...approvedDocument, id: 'address', label: 'Comprovante de residência', filePath: 'hr/onboarding/address.pdf' },
  ], ['address']);
  assert.deepEqual(selected.map((document) => document.id), ['address']);
});

test('token é opaco e apenas o hash é estável', () => {
  const created = createAccountantToken();
  assert.notEqual(created.token, created.hash);
  assert.equal(hashAccountantToken(created.token), created.hash);
  assert.match(accountantAttachmentName(3, 'Certidão de nascimento', 'pdf'), /^Anexo 03 - Certidao de nascimento\.pdf$/);
});
