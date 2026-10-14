import assert from 'node:assert/strict';
import test from 'node:test';

import { completeAbsenceTypeSchema } from '../../src/features/dp/absences/schemas';
import { absencePoliciesConflict, resolveAbsencePolicy } from '../../src/lib/dp-absence-rules';
import type { DPAbsencePolicy } from '../../src/types';

function policy(overrides: Partial<DPAbsencePolicy> = {}): DPAbsencePolicy {
  return {
    id: 'geral',
    name: 'Regra geral',
    employmentRelationshipTypes: ['clt', 'apprenticeship'],
    applicability: { scope: { kind: 'company' } },
    calculation: 'scheduled_workdays',
    attachment: 'required',
    approvalFlow: 'dp',
    rejectionReasonRequired: true,
    allowFutureEdit: true,
    allowFutureCancel: true,
    ...overrides,
  };
}

test('resolve regra individual antes da regra geral e inclui aprendiz', () => {
  const individual = policy({ id: 'individual', name: 'Exceção individual', applicability: { scope: { kind: 'company' }, collaboratorIds: ['person-1'] } });
  const result = resolveAbsencePolicy({ validFrom: '2026-01-01', policies: [policy(), individual] }, '2026-10-14', {
    collaboratorId: 'person-1',
    employmentRelationshipType: 'apprenticeship',
  });
  assert.equal(result.status, 'matched');
  if (result.status === 'matched') assert.equal(result.policy.id, 'individual');
});

test('não aplica ausência trabalhista a pessoa jurídica', () => {
  const result = resolveAbsencePolicy({ validFrom: '2026-01-01', policies: [policy()] }, '2026-10-14', {
    collaboratorId: 'person-pj',
    employmentRelationshipType: 'pj',
  });
  assert.deepEqual(result, { status: 'not_applicable' });
});

test('não aplica ausência trabalhista a vínculo societário', () => {
  const result = resolveAbsencePolicy({ validFrom: '2026-01-01', policies: [policy()] }, '2026-10-14', {
    collaboratorId: 'person-partner',
    employmentRelationshipType: 'partner',
  });
  assert.deepEqual(result, { status: 'not_applicable' });
});

test('identifica regras ambíguas no mesmo nível e o schema impede a publicação', () => {
  const left = policy({ id: 'left', name: 'Regra A', employmentRelationshipTypes: ['clt'] });
  const right = policy({ id: 'right', name: 'Regra B', employmentRelationshipTypes: ['clt'] });
  assert.equal(absencePoliciesConflict(left, right), true);

  const parsed = completeAbsenceTypeSchema.safeParse({
    name: 'Atestado médico',
    color: 'pink',
    requestUnits: ['day'],
    initiatedBy: ['collaborator'],
    workdayEffect: 'excused_absence',
    includeInAbsenteeism: false,
    blocksSchedule: true,
    policies: [left, right],
    validFrom: '2026-01-01',
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.issues[0]?.message ?? '', /empata/);
});

test('schema rejeita PJ como vínculo configurável', () => {
  const parsed = completeAbsenceTypeSchema.safeParse({
    name: 'Ausência', color: 'blue', requestUnits: ['day'], initiatedBy: ['dp'],
    workdayEffect: 'manual_review', includeInAbsenteeism: false, blocksSchedule: false,
    policies: [policy({ employmentRelationshipTypes: ['pj' as never] })], validFrom: '2026-01-01',
  });
  assert.equal(parsed.success, false);
});

test('catálogo de ausências aceita a paleta ampliada', () => {
  for (const color of ['red', 'orange', 'yellow', 'teal', 'cyan', 'indigo'] as const) {
    const parsed = completeAbsenceTypeSchema.safeParse({
      name: 'Ausência', color, requestUnits: ['day'], initiatedBy: ['dp'],
      workdayEffect: 'manual_review', includeInAbsenteeism: false, blocksSchedule: false,
      policies: [policy()], validFrom: '2026-01-01',
    });
    assert.equal(parsed.success, true, `cor ${color} deveria ser aceita`);
  }
});
