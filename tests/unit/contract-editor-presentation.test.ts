import assert from 'node:assert/strict';
import test from 'node:test';
import { createProbationProcess } from '../../src/features/hr/integration/probation-process';
import { contractProbationDates } from '../../src/components/dp/contract-probation-dates';
import { contractFormChanged } from '../../src/components/dp/contract-change-form';
import type { User } from '../../src/types';

test('datas contratuais preservam admissão e projetam o dia seguinte ao fim da experiência sem efetivar o vínculo', () => {
  const manual = createProbationProcess('2026-01-01', { effectivenessRule: 'manual' }, '2026-01-01T12:00:00Z');
  assert.equal(contractProbationDates(manual).start, '2026-01-01');
  assert.equal(contractProbationDates(manual).indefiniteStart, '2026-04-01');
  const automatic = { ...manual, config: { ...manual.config, effectivenessRule: 'automatic_at_end' as const } };
  assert.equal(contractProbationDates(automatic).indefiniteStart, '2026-04-01');
  assert.equal(contractProbationDates(automatic).indefiniteLabel, 'Início previsto do prazo indeterminado');
  assert.equal(contractProbationDates({ ...automatic, status: 'effective' }).indefiniteLabel, 'Início do prazo indeterminado');
  assert.equal(contractProbationDates({ ...automatic, status: 'terminated' }).indefiniteStart, null);
  assert.equal(contractProbationDates(null).start, null);
  assert.equal(contractProbationDates(null).indefiniteStart, null);
});

test('justificativa aparece só para alterações contratuais reais, sem acusar ordenação de funções', () => {
  const user = { id: 'example', employmentRelationshipType: 'clt', employerUnitId: 'employer', unitId: 'financial', jobRoleId: 'role', jobFunctionIds: ['b', 'a'] } as User;
  const draft = { employmentRelationshipType: 'clt', employerUnitId: 'employer', unitId: 'financial', jobRoleId: 'role', jobFunctionIds: ['a', 'b'], admissionDate: '2026-01-01' };
  assert.equal(contractFormChanged(user, draft, '2026-01-01'), false);
  assert.equal(contractFormChanged(user, { ...draft, unitId: 'other' }, '2026-01-01'), true);
  assert.equal(contractFormChanged(user, { ...draft, employerUnitId: 'other' }, '2026-01-01'), true);
  assert.equal(contractFormChanged(user, { ...draft, admissionDate: '2026-02-01' }, '2026-01-01'), true);
  assert.equal(contractFormChanged(user, { ...draft, jobFunctionIds: ['a'] }, '2026-01-01'), true);
  assert.equal(contractFormChanged(null, draft, ''), false);
});

test('projeta prazo indeterminado com datas históricas sem processo e respeita calendário civil', () => {
  assert.equal(contractProbationDates(null, { firstEnd: '2026-08-21', finalEnd: '2026-10-05' }).indefiniteStart, '2026-10-06');
  assert.equal(contractProbationDates(null, { firstEnd: '2028-02-28' }).indefiniteStart, '2028-02-29');
  assert.equal(contractProbationDates(null, { finalEnd: '2026-12-31' }).indefiniteStart, '2027-01-01');
  assert.equal(contractProbationDates(null, { finalEnd: '2026-02-30' }).indefiniteStart, null);
});
