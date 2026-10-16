import assert from 'node:assert/strict';
import test from 'node:test';
import { assessNatashaOperationalAvailability } from '../../src/lib/natasha-operational-availability';

const epoch = '12345678-1234-4234-8234-123456789abc';
const fenceId = '12345678-1234-4234-8234-123456789abd';
const projection = { id: 'request-one', requestId: 'request-one', workspaceId: 'workspace-one',
  beneficiaryUid: 'edna', unitId: 'shopping', requestVersion: 3, revision: 1, fenceId, epoch,
  state: 'active', blocksSchedule: true, startDate: '2026-10-20', endDate: '2026-10-21',
  intervals: [{ date: '2026-10-20', fromMinute: 0, toMinute: 1440 },
    { date: '2026-10-21', fromMinute: 540, toMinute: 720 }] };
const request = { id: 'request-one', workspaceId: 'workspace-one', beneficiaryUid: 'edna',
  unitId: 'shopping', startDate: '2026-10-20', endDate: '2026-10-21', status: 'approved', version: 3, revision: 1,
  segments: projection.intervals,
  operationalFence: { state: 'active', fenceId, requestVersion: 3 } };
function input() {
  return { workspaceId: 'workspace-one', epoch, sourceReady: true, from: '2026-10-01', through: '2026-11-14',
    candidates: [{ id: 'edna', name: 'Edna', allowedUnitIds: ['shopping'] }],
    projections: [{ ...projection }], requests: [{ ...request }] };
}
test('somente projeção ativa com ack RH e readiness compõe ausência aprovada', () => {
  const result = assessNatashaOperationalAvailability(input());
  assert.deepEqual(result.issues, []);
  assert.equal(result.approvedAbsences[0]?.employeeName, 'Edna');
  assert.equal(result.approvedAbsences[0]?.intervals.length, 2);
});
test('preparação, ack pendente, reversão pendente e fonte incompleta nunca viram livre/pronta', () => {
  for (const changed of [
    { projections: [{ ...projection, state: 'prepared' }] },
    { requests: [{ ...request, operationalFence: { ...request.operationalFence, state: 'activation_pending' } }] },
    { requests: [{ ...request, status: 'cancelled', operationalFence: { ...request.operationalFence, state: 'reversal_pending' } }] },
    { sourceReady: false }, { epoch: null }, { projections: [] }, { requests: [] },
  ]) {
    const result = assessNatashaOperationalAvailability({ ...input(), ...changed });
    assert.ok(result.issues.length > 0);
    assert.deepEqual(result.approvedAbsences, []);
  }
});
test('unidade, workspace, versão, data civil e projeção duplicada falham fechados', () => {
  for (const changed of [
    { projections: [{ ...projection, unitId: 'other' }] },
    { projections: [{ ...projection, workspaceId: 'other' }] },
    { projections: [{ ...projection, requestVersion: 2 }] },
    { projections: [{ ...projection, intervals: [{ date: '2026-02-31', fromMinute: 0, toMinute: 1440 }] }] },
    { projections: [{ ...projection }, { ...projection }] },
  ]) {
    const result = assessNatashaOperationalAvailability({ ...input(), ...changed });
    assert.ok(result.issues.includes('ABSENCE_INCONSISTENT'));
    assert.deepEqual(result.approvedAbsences, []);
  }
});
