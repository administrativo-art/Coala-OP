import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changedIdentityFields,
  formDataValidationIsCurrent,
  nextPublicFormRevision,
  publicFormAnswersEqual,
} from '../../../src/features/hr/onboarding/public-form-revision';

test('reenvio apenas documental mantém a mesma revisão do formulário', () => {
  const answers = { fullName: 'Thaise Correia Marinho', cpf: '05813688358', children: [] };
  assert.equal(publicFormAnswersEqual(answers, { cpf: '05813688358', children: [], fullName: 'Thaise Correia Marinho' }), true);
  assert.equal(nextPublicFormRevision({ currentRevision: 3, hasPreviousSubmission: true, answersChanged: false }), 3);
});

test('mudança de nome ou CPF é identificada e incrementa a revisão', () => {
  const previous = { fullName: 'Thaise Correia Marinho', cpf: '05813688358' };
  const next = { fullName: 'Thaise C. Marinho', cpf: '058.136.883-59' };
  assert.deepEqual(changedIdentityFields(previous, next), ['fullName', 'cpf']);
  assert.equal(nextPublicFormRevision({ currentRevision: 3, hasPreviousSubmission: true, answersChanged: true }), 4);
});

test('a validação usa a revisão e mantém a fase depois do e-mail de agendamento', () => {
  assert.equal(formDataValidationIsCurrent({ publicFormRevision: 2, validationRevision: 2 }), true);
  assert.equal(formDataValidationIsCurrent({ publicFormRevision: 3, validationRevision: 2 }), false);
  assert.equal(formDataValidationIsCurrent({
    publicFormRevision: 3,
    validationRevision: 2,
    schedulingEmailSentAt: '2026-08-21T15:00:00.000Z',
  }), true);
});

test('o envio inicial começa na revisão um e a primeira correção vai para a revisão dois', () => {
  assert.equal(nextPublicFormRevision({ currentRevision: null, hasPreviousSubmission: false, answersChanged: true }), 1);
  assert.equal(nextPublicFormRevision({ currentRevision: null, hasPreviousSubmission: true, answersChanged: true }), 2);
});

test('formalizações legadas continuam usando o marcador de submissão', () => {
  assert.equal(formDataValidationIsCurrent({
    publicFormLastSubmittedAt: '2026-08-21T14:37:30.747Z',
    validationSubmissionAt: '2026-08-21T14:37:30.747Z',
  }), true);
});
