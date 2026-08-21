import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changedIdentityFields,
  essentialPublicFormDataReady,
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

test('o envio dos dados essenciais libera o formulário sem confirmação manual do RH', () => {
  assert.equal(essentialPublicFormDataReady({
    publicFormSubmittedAt: '2026-08-21T14:37:30.747Z',
    candidateName: 'Thaise Correia Marinho',
    publicFormAnswers: { cpf: '058.136.883-58' },
  }), true);
  assert.equal(essentialPublicFormDataReady({
    publicFormSubmittedAt: null,
    candidateName: 'Thaise Correia Marinho',
    publicFormAnswers: { cpf: '05813688358' },
  }), false);
  assert.equal(essentialPublicFormDataReady({
    publicFormSubmittedAt: '2026-08-21T14:37:30.747Z',
    candidateName: 'Thaise Correia Marinho',
    publicFormAnswers: { fullName: '', cpf: '05813688358' },
  }), true);
});

test('o envio inicial começa na revisão um e a primeira correção vai para a revisão dois', () => {
  assert.equal(nextPublicFormRevision({ currentRevision: null, hasPreviousSubmission: false, answersChanged: true }), 1);
  assert.equal(nextPublicFormRevision({ currentRevision: null, hasPreviousSubmission: true, answersChanged: true }), 2);
});

test('dados essenciais incompletos não liberam o envio', () => {
  assert.equal(essentialPublicFormDataReady({
    publicFormSubmittedAt: '2026-08-21T14:37:30.747Z',
    candidateName: '',
    publicFormAnswers: { cpf: '05813688358' },
  }), false);
  assert.equal(essentialPublicFormDataReady({
    publicFormSubmittedAt: '2026-08-21T14:37:30.747Z',
    candidateName: 'Thaise Correia Marinho',
    publicFormAnswers: { cpf: '123' },
  }), false);
});
