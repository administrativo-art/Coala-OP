import assert from 'node:assert/strict';
import test from 'node:test';

import {
  onboardingProgress,
  resolveOnboardingOperationalStatus,
  sortOnboardingProcesses,
} from '../../../src/features/hr/onboarding/operational-status';
import { createPjOnboardingWorkflow } from '../../../src/features/hr/onboarding-pj/core';
import type { OnboardingProcess } from '../../../src/types';

const NOW = new Date('2026-08-06T15:00:00.000Z');

function process(overrides: Partial<OnboardingProcess> = {}): OnboardingProcess {
  return {
    id: 'onboarding-1',
    candidateId: 'candidate-1',
    candidateName: 'Ana Teste',
    candidateEmail: 'ana@example.com',
    employmentRelationshipType: 'clt',
    status: 'collecting_documents',
    currentStage: 'documents',
    currentStageStartedAt: '2026-08-06T12:00:00.000Z',
    stages: [
      { id: 'documents', label: 'Coleta', order: 0, required: true, dueDays: 3 },
      { id: 'document_review', label: 'Conferência', order: 1, required: true, dueDays: 2 },
      { id: 'done', label: 'Finalizado', order: 2, required: true, dueDays: null },
    ],
    documents: [
      { id: 'identity', label: 'Identidade', required: true, status: 'pending' },
    ],
    createdAt: '2026-08-06T12:00:00.000Z',
    updatedAt: '2026-08-06T12:00:00.000Z',
    ...overrides,
  };
}

test('CLT diferencia espera da pessoa e ação do RH', () => {
  const waiting = resolveOnboardingOperationalStatus(process(), NOW);
  assert.equal(waiting.health, 'waiting_person');
  assert.equal(waiting.responsible, 'person');

  const review = resolveOnboardingOperationalStatus(process({
    status: 'reviewing_documents',
    currentStage: 'document_review',
    publicFormSubmittedAt: '2026-08-06T13:00:00.000Z',
    documents: [{ id: 'identity', label: 'Identidade', required: true, status: 'received', filePath: 'hr/onboarding/id.pdf' }],
  }), NOW);
  assert.equal(review.health, 'hr_action');
  assert.match(review.headline, /revisar documentos/i);
});

test('falha operacional tem precedência sobre atraso', () => {
  const result = resolveOnboardingOperationalStatus(process({
    currentStageStartedAt: '2026-07-01T12:00:00.000Z',
    accessProvisioning: { status: 'failed', email: { status: 'failed', lastError: 'E-mail recusado' } },
  }), NOW);
  assert.equal(result.health, 'blocked');
  assert.equal(result.detail, 'E-mail recusado');
});

test('prazo usa a entrada da etapa sem depender de updatedAt', () => {
  const result = resolveOnboardingOperationalStatus(process({
    currentStageStartedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-06T14:59:00.000Z',
  }), NOW);
  assert.equal(result.health, 'overdue');
  assert.equal(result.daysInStage, 5);
  assert.equal(result.overdueDays, 2);
});

test('PJ usa as oito etapas e identifica espera de assinatura', () => {
  const workflow = createPjOnboardingWorkflow({
    cnpj: '12345678000190',
    legalName: 'Prestadora Teste Ltda',
    email: 'pj@example.com',
    contractStartDate: '2026-08-10',
    termType: 'indefinite',
    monthlyValue: 5000,
    paymentDay: 10,
    serviceItems: [],
    now: '2026-08-01T12:00:00.000Z',
    actorId: 'rh-1',
  });
  workflow.currentStep = 'contract_signature';
  workflow.steps.contract_signature.status = 'active';
  workflow.contract = { status: 'sent' };
  const pj = process({ employmentRelationshipType: 'pj', pjWorkflow: workflow, expectedAdmissionDate: null });
  const result = resolveOnboardingOperationalStatus(pj, NOW);
  const progress = onboardingProgress(pj);
  assert.equal(result.health, 'waiting_person');
  assert.match(result.headline, /assinaturas/i);
  assert.equal(progress.total, 8);
  assert.equal(progress.current, 5);
});

test('ordenação por prioridade coloca bloqueados antes de ações do RH', () => {
  const blocked = process({ id: 'blocked', candidateName: 'Bloqueada', accessProvisioning: { status: 'failed' } });
  const action = process({
    id: 'action',
    candidateName: 'Ação',
    currentStage: 'document_review',
    publicFormSubmittedAt: '2026-08-06T13:00:00.000Z',
    documents: [{ id: 'identity', label: 'Identidade', required: true, status: 'received', filePath: 'id.pdf' }],
  });
  assert.deepEqual(sortOnboardingProcesses([action, blocked], 'priority', NOW).map(item => item.id), ['blocked', 'action']);
});

test('modelo configurável não substitui o fluxo operacional da ficha', () => {
  const integrationV2 = {
    currentStageId: 'etapa_modelo',
    currentStageStartedAt: '2026-07-01T12:00:00.000Z',
    stageStatuses: { etapa_modelo: 'active' },
    actionResults: { acao: { status: 'failed', executedAt: NOW.toISOString(), error: 'Falha do modelo' } },
    snapshot: { stages: [{ id: 'etapa_modelo', label: 'Etapa do modelo', order: 0 }] },
  } as unknown as NonNullable<OnboardingProcess['integrationV2']>;
  const item = process({ integrationV2 });
  const progress = onboardingProgress(item);
  const status = resolveOnboardingOperationalStatus(item, NOW);

  assert.equal(progress.label, 'Formalização · Dados, documentos e ASO');
  assert.equal(progress.total, 2);
  assert.equal(status.health, 'waiting_person');
});
