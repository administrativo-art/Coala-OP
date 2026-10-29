import assert from 'node:assert/strict';
import test from 'node:test';

import { countsDPShiftTowardGoals, externalCoverageUserIds, resolveDPShiftAssignment } from '../../src/lib/dp-external-coverage';

test('mantém turno regular quando a unidade de execução pertence à pessoa', () => {
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'loja-1', user: { unitId: 'loja-1', unitIds: ['loja-1'] } }), {
    assignmentKind: 'regular', countsTowardGoals: true,
  });
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'unit-local', executionUnitExternalId: 'kiosk-9', user: { assignedKioskIds: ['kiosk-9'], unitId: 'unit-local' } }), {
    assignmentKind: 'regular', countsTowardGoals: true,
  });
});

test('deriva cobertura externa, origem e exclusão de metas sem alterar o vínculo', () => {
  const user = { unitId: 'origem', unitIds: ['origem'], assignedKioskIds: ['kiosk-origem'] };
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'destino', user }), {
    assignmentKind: 'external_coverage', originUnitId: 'origem', countsTowardGoals: false,
  });
  assert.deepEqual(user, { unitId: 'origem', unitIds: ['origem'], assignedKioskIds: ['kiosk-origem'] });
  assert.equal(countsDPShiftTowardGoals({ countsTowardGoals: false }), false);
  assert.equal(countsDPShiftTowardGoals({}), true);
});

test('usa unidades de escala e operação antes da referência financeira', () => {
  const user = { unitId: 'financeira', unitIds: ['operacional-a', 'operacional-b'] };
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'destino', user }), {
    assignmentKind: 'external_coverage', originUnitId: 'operacional-a', countsTowardGoals: false,
  });
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'financeira', user }), {
    assignmentKind: 'external_coverage', originUnitId: 'operacional-a', countsTowardGoals: false,
  });
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'operacional-b', user }), {
    assignmentKind: 'regular', countsTowardGoals: true,
  });
});

test('recusa cobertura sem unidade de origem canônica', () => {
  assert.throws(
    () => resolveDPShiftAssignment({ executionUnitId: 'destino', user: { assignedKioskIds: ['legado'] } }),
    /EXTERNAL_COVERAGE_ORIGIN_REQUIRED/,
  );
});

test('identifica pessoas que não podem reaparecer no fallback de metas', () => {
  const ids = externalCoverageUserIds([
    { userId: 'regular', countsTowardGoals: true },
    { userId: 'externa', countsTowardGoals: false },
    { userId: 'legada' },
  ]);
  assert.deepEqual([...ids], ['externa']);
});
