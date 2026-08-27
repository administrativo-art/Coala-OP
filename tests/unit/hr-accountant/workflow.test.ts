import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountantAttachmentName, candidateDocumentsForAccountant, createAccountantToken, hashAccountantToken, missingAccountantPrerequisites, selectableCandidateDocumentsForAccountant } from '../../../src/features/hr/accountant/workflow';
import { normalizeOnboardingStages } from '../../../src/lib/recruitment-onboarding';
import type { OnboardingDocument } from '../../../src/types';

const approvedDocument: OnboardingDocument = { id: 'identity_document', label: 'Documento de identificação', required: true, status: 'approved', filePath: 'hr/onboarding/id.pdf' };

test('etapa do contador fica entre conferência e preparação de assinatura', () => {
  const stages = normalizeOnboardingStages(null);
  assert.ok(stages.findIndex((stage) => stage.id === 'document_review') < stages.findIndex((stage) => stage.id === 'accountant'));
  assert.ok(stages.findIndex((stage) => stage.id === 'accountant') < stages.findIndex((stage) => stage.id === 'signature_preparation'));
});

test('pré-requisitos da etapa exigem somente documentos e ASO', () => {
  assert.deepEqual(missingAccountantPrerequisites({ documents: [approvedDocument], asoApproved: true }), []);
  assert.equal(missingAccountantPrerequisites({ documents: [{ ...approvedDocument, status: 'received' }], asoApproved: false }).length, 2);
});

test('documento condicional inaplicável não bloqueia a contabilidade', () => {
  const missing = missingAccountantPrerequisites({
    documents: [
      approvedDocument,
      { id: 'cnh', label: 'CNH', required: true, status: 'pending', filePath: null },
    ],
    asoApproved: true,
    publicFormAnswers: { hasCnh: 'no', identityDocumentType: 'identity' },
  });
  assert.deepEqual(missing, []);
});

test('pacote inclui somente documentos aprovados com arquivo e exclui o ASO duplicado', () => {
  const selected = candidateDocumentsForAccountant([
    approvedDocument,
    { id: 'aso_admission', label: 'ASO', required: true, status: 'approved', filePath: 'aso.pdf', documentTypeCode: 'ASO_ADMISSION' },
    { id: 'pending', label: 'Pendente', required: false, status: 'received', filePath: 'pending.pdf' },
  ]);
  assert.deepEqual(selected.map((document) => document.id), ['identity_document']);
});

test('pacote mantém identificação e dependentes automáticos, além da seleção do RH', () => {
  const selected = candidateDocumentsForAccountant([
    approvedDocument,
    { ...approvedDocument, id: 'child_1_birth_certificate', label: 'Certidão - Filho 1', filePath: 'hr/onboarding/child.pdf' },
    { ...approvedDocument, id: 'address', label: 'Comprovante de residência', filePath: 'hr/onboarding/address.pdf' },
  ], ['address']);
  assert.deepEqual(selected.map((document) => document.id), ['identity_document', 'child_1_birth_certificate', 'address']);
});

test('seleção do RH oferece somente documentos opcionais', () => {
  const selectable = selectableCandidateDocumentsForAccountant([
    approvedDocument,
    { ...approvedDocument, id: 'child_1_birth_certificate', label: 'Certidão - Filho 1', filePath: 'hr/onboarding/child.pdf' },
    { ...approvedDocument, id: 'address', label: 'Comprovante de residência', filePath: 'hr/onboarding/address.pdf' },
  ]);
  assert.deepEqual(selectable.map((document) => document.id), ['address']);
});

test('token é opaco e apenas o hash é estável', () => {
  const created = createAccountantToken();
  assert.notEqual(created.token, created.hash);
  assert.equal(hashAccountantToken(created.token), created.hash);
  assert.match(accountantAttachmentName(3, 'Certidão de nascimento', 'pdf'), /^Anexo 03 - Certidao de nascimento\.pdf$/);
});
