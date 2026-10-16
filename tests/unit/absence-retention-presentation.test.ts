import assert from 'node:assert/strict';
import test from 'node:test';

import { retentionDecisionPath, retentionExecutionPath, retentionListPath, type AbsenceRetentionCase } from '../../src/features/dp/absences/requests/retention-client';
import { belemCivilDate, canDecideRetention, canExecuteRetention, retentionDecisionError, retentionStates } from '../../src/features/dp/absences/requests/retention-presentation';

const item = { id: 'case-1', requestId: 'request-1', fileId: 'file-1', beneficiaryUid: 'employee-1', unitId: 'unit-1',
  custodianUid: 'reviewer-1', state: 'awaiting_authorization', version: 2, reviewAfter: '2026-10-15',
  updatedAt: '2026-10-15T12:00:00Z', decision: null } satisfies AbsenceRetentionCase;

test('cliente exige unidade, limita página e separa decisão de execução', () => {
  assert.throws(() => retentionListPath({ unitId: '' }), /Selecione uma unidade/);
  assert.equal(retentionListPath({ unitId: 'unit-1', state: 'awaiting_authorization', limit: 25, cursor: 'case-1' }),
    '/api/dp/absence-retention?unitId=unit-1&limit=25&state=awaiting_authorization&cursor=case-1');
  assert.equal(retentionDecisionPath('request_file'), '/api/dp/absence-retention/request_file/decision');
  assert.doesNotMatch(retentionDecisionPath('request_file'), /execute/);
  assert.equal(retentionExecutionPath('request_file'), '/api/dp/absence-retention/request_file/execute');
});

test('treze estados têm rótulos humanos; somente o custodiante executa caso autorizado', () => {
  assert.equal(Object.keys(retentionStates).length, 13);
  assert.match(retentionStates.authorized.detail, /iniciar a remoção/i);
  assert.match(retentionStates.execution_blocked.detail, /não está habilitada/i);
  assert.match(retentionStates.needs_revalidation.detail, /conferir/i);
  assert.equal(canDecideRetention(item, 'reviewer-1'), true);
  assert.equal(canDecideRetention(item, 'employee-1'), false);
  assert.equal(canDecideRetention({ ...item, state: 'authorized' }, 'reviewer-1'), false);
  assert.equal(canExecuteRetention({ ...item, state: 'authorized' }, 'reviewer-1'), true);
  assert.equal(canExecuteRetention({ ...item, state: 'authorized' }, 'employee-1'), false);
  assert.equal(belemCivilDate(new Date('2026-10-15T02:30:00Z')), '2026-10-14');
  assert.match(retentionDecisionError('retain', 'Motivo suficiente', '', '2026-10-14') ?? '', /revisão futura/);
  assert.match(retentionDecisionError('retain', 'Motivo suficiente', '2026-10-14', '2026-10-14') ?? '', /revisão futura/);
  assert.equal(retentionDecisionError('retain', 'Motivo suficiente', '2026-10-15', '2026-10-14'), null);
  assert.match(retentionDecisionError('authorize_delete', 'curto', '', '2026-10-14') ?? '', /motivo/);
});
