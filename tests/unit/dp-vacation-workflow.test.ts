import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceVacationWorkflowToNotice,
  analyzeVacationScheduling,
  cancelVacationWorkflow,
  createInitialVacationWorkflow,
  vacationWorkflowDeadlines,
} from '../../src/lib/dp-vacation-workflow';

test('calcula os marcos do aviso e do pagamento a partir do início do gozo', () => {
  assert.deepEqual(vacationWorkflowDeadlines('2026-10-01'), {
    noticeDeadline: '2026-09-01',
    paymentDeadline: '2026-09-29',
  });
});

test('considera exatamente 30 dias como comunicação dentro do prazo', () => {
  const analysis = analyzeVacationScheduling({
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    asOfDate: '2026-09-01',
  });

  assert.equal(analysis.noticeLeadDays, 30);
  assert.equal(
    analysis.checks.find((check) => check.code === 'notice_lead_time')?.status,
    'ok',
  );
});

test('antecedência inferior a 30 dias gera alerta não impeditivo', () => {
  const analysis = analyzeVacationScheduling({
    startDate: '2026-09-20',
    endDate: '2026-10-04',
    asOfDate: '2026-09-01',
  });
  const leadTime = analysis.checks.find((check) => check.code === 'notice_lead_time');

  assert.equal(analysis.noticeLeadDays, 19);
  assert.equal(leadTime?.status, 'warning');
  assert.equal(leadTime?.blocking, false);
});

test('trilha planejada começa na análise e mantém assinatura do recibo bloqueada', () => {
  const workflow = createInitialVacationWorkflow({
    status: 'PLANNED',
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    asOfDate: '2026-09-01',
    now: '2026-09-01T12:00:00.000-03:00',
    actorId: 'rh-1',
  });

  assert.equal(workflow.currentStage, 'scheduling');
  assert.equal(workflow.steps[0].status, 'in_progress');
  assert.equal(workflow.receiptSignature.status, 'blocked_until_payment');
  assert.equal(workflow.payment.dueAt, '2026-09-29');
});

test('aprovação conclui o agendamento e abre a geração do aviso', () => {
  const workflow = createInitialVacationWorkflow({
    status: 'PLANNED',
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    asOfDate: '2026-09-01',
    now: '2026-09-01T12:00:00.000-03:00',
  });
  const approved = advanceVacationWorkflowToNotice(workflow, {
    now: '2026-09-02T09:00:00.000-03:00',
    actorId: 'rh-2',
  });

  assert.equal(approved.currentStage, 'notice');
  assert.equal(approved.steps.find((step) => step.id === 'scheduling')?.status, 'completed');
  assert.equal(approved.steps.find((step) => step.id === 'notice')?.status, 'in_progress');
  assert.equal(approved.notice.status, 'not_generated');
});

test('rejeição cancela somente os passos ainda não concluídos', () => {
  const approved = createInitialVacationWorkflow({
    status: 'APPROVED',
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    asOfDate: '2026-09-01',
    now: '2026-09-01T12:00:00.000-03:00',
    actorId: 'rh-1',
  });
  const cancelled = cancelVacationWorkflow(approved, '2026-09-02T09:00:00.000-03:00');

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.steps.find((step) => step.id === 'scheduling')?.status, 'completed');
  assert.equal(cancelled.steps.find((step) => step.id === 'notice')?.status, 'cancelled');
});
