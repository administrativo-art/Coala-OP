import assert from 'node:assert/strict';
import test from 'node:test';

import { onboardingConceptualStageNumber } from '../../../src/features/hr/onboarding/detail-navigation';

test('mapeia o estado técnico para as sete etapas conceituais do handoff', () => {
  assert.equal(onboardingConceptualStageNumber({ status: 'collecting_documents', currentStage: 'documents' }), 1);
  assert.equal(onboardingConceptualStageNumber({ status: 'reviewing_documents', currentStage: 'document_review' }), 1);
  assert.equal(onboardingConceptualStageNumber({ status: 'accountant_pending', currentStage: 'accountant' }), 2);
  assert.equal(onboardingConceptualStageNumber({ status: 'contract_pending', currentStage: 'signature_preparation' }), 3);
  assert.equal(onboardingConceptualStageNumber({ status: 'ready_to_create_user', currentStage: 'formalization_validation' }), 4);
  assert.equal(onboardingConceptualStageNumber({ status: 'active', currentStage: 'integration' }), 5);
  assert.equal(onboardingConceptualStageNumber({ status: 'active', currentStage: 'probation' }), 6);
  assert.equal(onboardingConceptualStageNumber({ status: 'completed', currentStage: 'done' }), 7);
});
