import assert from 'node:assert/strict';
import test from 'node:test';
import { appendOperationalPeriod, operationalUnitsOnDate, validateOperationalPeriods } from '../../src/lib/operational-unit-periods';
import { resolveDPShiftAssignment } from '../../src/lib/dp-external-coverage';
import { userMatchesDPUnit } from '../../src/lib/dp-schedule-roster';

test('vigência 1 requer início real e permanece aberta até a próxima definição', () => {
  assert.throws(() => appendOperationalPeriod([], '', ['tirirical']));
  const first = appendOperationalPeriod([], '2026-10-22', ['tirirical', 'matriz']);
  assert.deepEqual(first, [{ validFrom: '2026-10-22', unitIds: ['tirirical', 'matriz'] }]);
  const next = appendOperationalPeriod(first, '2026-11-01', ['matriz']);
  assert.equal(next[0].validTo, '2026-10-31');
  assert.equal(first[0].validTo, undefined);
  assert.equal(next[1].validTo, undefined);
  assert.deepEqual(operationalUnitsOnDate({ operationalUnitPeriods: next }, '2026-10-31'), ['tirirical', 'matriz']);
  assert.deepEqual(operationalUnitsOnDate({ operationalUnitPeriods: next }, '2026-11-01'), ['matriz']);
  assert.deepEqual(operationalUnitsOnDate({ operationalUnitPeriods: next }, '2026-10-21'), []);
});

test('rejeita datas impossíveis, sobreposição e unidade vazia', () => {
  assert.throws(() => appendOperationalPeriod([], '2026-02-30', ['x']));
  assert.throws(() => appendOperationalPeriod([], '2026-10-22', []));
  assert.equal(validateOperationalPeriods([{ validFrom: '2026-10-22', unitIds: ['x'] }, { validFrom: '2026-10-23', unitIds: ['y'] }]), false);
  assert.throws(() => appendOperationalPeriod([{ validFrom: '2026-10-22', unitIds: ['x'] }], '2026-10-22', ['y']));
});

test('escala usa a mesma data sem incluir silenciosamente quiosque ou financeiro', () => {
  const user = { unitId: 'financeira', unitIds: ['antiga'], assignedKioskIds: ['quiosque'],
    operationalUnitPeriods: appendOperationalPeriod([], '2026-11-01', ['matriz']) };
  assert.equal(userMatchesDPUnit(user, 'matriz', [], [], '2026-10-31'), false);
  assert.equal(userMatchesDPUnit(user, 'matriz', [], [], '2026-11-01'), true);
  assert.equal(userMatchesDPUnit(user, 'quiosque', [], [], '2026-11-01'), false);
  assert.throws(() => resolveDPShiftAssignment({ executionUnitId: 'matriz', user, date: '2026-10-31' }));
  assert.equal(resolveDPShiftAssignment({ executionUnitId: 'matriz', user, date: '2026-11-01' }).assignmentKind, 'regular');
  assert.deepEqual(resolveDPShiftAssignment({ executionUnitId: 'outra', user, date: '2026-11-01' }),
    { assignmentKind: 'external_coverage', originUnitId: 'matriz', countsTowardGoals: false });
});
