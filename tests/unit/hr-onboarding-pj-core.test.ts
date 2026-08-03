import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPjOnboardingWorkflow,
  PJ_ONBOARDING_STEP_ORDER,
  pjRequiredRegistrationFieldsMissing,
  sanitizePjServiceItems,
  setPjWorkflowStep,
} from '../../src/features/hr/onboarding-pj/core';

function workflow() {
  return createPjOnboardingWorkflow({
    cnpj: '12345678000190',
    legalName: 'Prestadora Teste Ltda',
    tradeName: 'Prestadora Teste',
    email: 'unico@prestadora.test',
    contractStartDate: '2026-08-10',
    termType: 'indefinite',
    monthlyValue: 5000,
    paymentDay: 10,
    serviceItems: [{ id: 'scope_1', front: 'Administração', deliverable: 'Relatório mensal', order: 0 }],
    now: '2026-08-03T12:00:00.000Z',
    actorId: 'rh-1',
  });
}

test('fluxo PJ nasce com oito etapas e cadastro externo ativo', () => {
  const result = workflow();
  assert.equal(PJ_ONBOARDING_STEP_ORDER.length, 8);
  assert.equal(result.currentStep, 'provider_registration');
  assert.equal(result.steps.contract_definition.status, 'completed');
  assert.equal(result.steps.provider_registration.status, 'active');
  assert.equal(result.steps.provider_activation.status, 'pending');
  assert.equal(result.terms.invoiceRequired, true);
  assert.equal(result.provider.email, 'unico@prestadora.test');
});

test('avanço conclui a etapa atual e ativa somente a próxima', () => {
  const result = setPjWorkflowStep(workflow(), 'registration_review', '2026-08-04T12:00:00.000Z', 'provider');
  assert.equal(result.currentStep, 'registration_review');
  assert.equal(result.steps.provider_registration.status, 'completed');
  assert.equal(result.steps.registration_review.status, 'active');
  assert.equal(result.steps.registration_review.completedAt, null);
});

test('escopo aceita apenas frente e entregável e descarta linhas vazias', () => {
  const result = sanitizePjServiceItems([
    { id: 'linha 1!', front: '  Recrutamento  ', deliverable: ' Parecer por vaga ' },
    { front: '  ', deliverable: ' ' },
    { front: 'Integração', deliverable: 'Registro de aplicação' },
  ]);
  assert.deepEqual(result, [
    { id: 'linha1', front: 'Recrutamento', deliverable: 'Parecer por vaga', order: 0 },
    { id: 'scope_3', front: 'Integração', deliverable: 'Registro de aplicação', order: 2 },
  ]);
});

test('validação cadastral exige dados bancários conforme a forma escolhida', () => {
  const base = {
    companyAddress: 'Rua Teste, 1', companyPhone: '91999999999',
    representativeName: 'Representante', representativeCpf: '12345678901',
    representativeQualification: 'brasileiro, empresário',
    bankHolderName: 'Prestadora Teste Ltda', bankHolderDocument: '12345678000190',
  };
  assert.deepEqual(pjRequiredRegistrationFieldsMissing({ ...base, bankMethod: 'pix', pixKey: 'unico@prestadora.test' }), []);
  assert.deepEqual(pjRequiredRegistrationFieldsMissing({ ...base, bankMethod: 'bank', bankName: 'Banco', bankAgency: '1', bankAccount: '' }), ['Conta']);
});
