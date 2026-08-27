import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUpdateExpectedAdmissionDate,
  normalizeOnboardingCancellationReason,
  normalizeOnboardingDateOnly,
} from '../../../src/features/hr/onboarding-lifecycle';

test('data prevista pode mudar até a conclusão da etapa do contador', () => {
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'collecting_documents', currentStage: 'documents' }), true);
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'reviewing_documents', currentStage: 'document_review' }), true);
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'accountant_pending', currentStage: 'accountant' }), true);
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'contract_pending', currentStage: 'signature_preparation' }), false);
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'cancelled', currentStage: 'documents' }), false);
  assert.equal(canUpdateExpectedAdmissionDate({ status: 'completed', currentStage: 'document_review' }), false);
});

test('data prevista exige uma data real no formato ISO sem horário', () => {
  assert.equal(normalizeOnboardingDateOnly('2026-08-06'), '2026-08-06');
  assert.equal(normalizeOnboardingDateOnly('2026-02-30'), null);
  assert.equal(normalizeOnboardingDateOnly('06/08/2026'), null);
});

test('encerramento exige motivo detalhado e limita o registro', () => {
  assert.equal(normalizeOnboardingCancellationReason('curto'), null);
  assert.equal(normalizeOnboardingCancellationReason('  Candidata desistiu da vaga.  '), 'Candidata desistiu da vaga.');
  assert.equal(normalizeOnboardingCancellationReason('a'.repeat(2100))?.length, 2000);
});
