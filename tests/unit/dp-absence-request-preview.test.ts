import assert from 'node:assert/strict';
import test from 'node:test';

import { absenceRequestPreviewSchema } from '@/features/dp/absences/requests/schemas';
import { AbsencePreviewError, belemCivilDate, listAbsenceRequestOptions, previewAbsenceRequest } from '@/features/dp/absences/requests/core';
import type { DPAbsenceType } from '@/types';

const target = { collaboratorId: 'alice', employmentRelationshipType: 'clt' as const, unitId: 'unit-1' };
const basePolicy = {
  id: 'rule-1', name: 'Regra própria', employmentRelationshipTypes: ['clt' as const],
  applicability: { scope: { kind: 'company' as const } },
  calculation: 'calendar_days' as const, attachment: 'required' as const,
  approvalFlow: 'manager_then_dp' as const, rejectionReasonRequired: true,
  allowFutureEdit: false, allowFutureCancel: false, instructions: 'Comprovante necessário.',
};
const baseType = {
  id: 'type-1', lineageId: 'line-1', version: 2, status: 'published', publishedAt: {},
  name: 'Afastamento', color: 'blue', requestUnits: ['day', 'hour'], initiatedBy: ['collaborator'],
  validFrom: '2026-01-01', validTo: '2026-12-31', policies: [basePolicy],
} as unknown as DPAbsenceType;
const input = { absenceTypeId: 'type-1', startDate: '2026-10-20', endDate: '2026-10-22', unit: 'day' as const };

test('schema aceita datas civis e rejeita campos forjados, datas irreais e períodos excessivos', () => {
  assert.equal(absenceRequestPreviewSchema.safeParse(input).success, true);
  for (const forged of [{ collaboratorId: 'bob' }, { workspaceId: 'other' }, { status: 'approved' }, { quantity: 1 }]) {
    assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, ...forged }).success, false);
  }
  assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, startDate: '2026-02-30' }).success, false);
  assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, endDate: '2027-12-31' }).success, false);
  assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, absenceTypeId: '../other' }).success, false);
  assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, endDate: input.startDate, unit: 'hour', startTime: '22:00', endTime: '02:00' }).success, false);
  assert.equal(absenceRequestPreviewSchema.safeParse({ ...input, unit: 'hour', startTime: '22:00', endTime: '02:00', endDate: '2026-10-21' }).success, true);
});

test('opções exibem apenas publicados aplicáveis à própria pessoa e campos mínimos', () => {
  const restricted = { ...baseType, id: 'restricted', policies: [{ ...basePolicy, applicability: { scope: { kind: 'company' }, collaboratorIds: ['bob'] } }] } as DPAbsenceType;
  const archived = { ...baseType, id: 'archived', status: 'archived' } as DPAbsenceType;
  const draft = { ...baseType, id: 'draft', status: 'draft' } as DPAbsenceType;
  const options = listAbsenceRequestOptions([baseType, restricted, archived, draft], target, '2026-10-14');
  assert.deepEqual(options.map((option) => option.id), ['type-1']);
  assert.deepEqual(Object.keys(options[0]).sort(), ['attachmentRequired', 'calculation', 'color', 'id', 'name', 'units', 'validFrom', 'validTo']);
  assert.equal(options[0].calculation, 'calendar_days');
  assert.deepEqual(listAbsenceRequestOptions([baseType], { ...target, employmentRelationshipType: 'pj' }, '2026-10-14'), []);
});

test('prévia calcula dias inclusivos, preserva regra pública sem expor público alvo e não altera fonte', () => {
  const source = structuredClone(baseType);
  const preview = previewAbsenceRequest(input, baseType, target, '2026-10-14');
  assert.equal(preview.quantity.value, 3);
  assert.equal(preview.canSubmit, false);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.source, 'coala');
  assert.equal(preview.attachmentRequired, true);
  assert.ok(preview.pending.includes('document_required'));
  assert.equal(preview.limits.remaining, null);
  assert.equal('applicability' in preview.rule.snapshot, false);
  assert.equal('employmentRelationshipTypes' in preview.rule.snapshot, false);
  assert.deepEqual(baseType, source);
  preview.rule.snapshot.name = 'Alterada';
  assert.equal(baseType.policies[0].name, 'Regra própria');
});

test('retorno exclusivo pode cair após fim da vigência; mesmo dia não produz ausência', () => {
  const type = { ...baseType, validTo: '2026-10-31', policies: [{ ...basePolicy, calculation: 'calendar_days_until_return' }] } as DPAbsenceType;
  assert.equal(previewAbsenceRequest({ ...input, startDate: '2026-10-31', endDate: '2026-11-01' }, type, target, '2026-10-14').quantity.value, 1);
  assert.throws(() => previewAbsenceRequest({ ...input, startDate: '2026-10-31', endDate: '2026-10-31' }, type, target, '2026-10-14'), (error) => error instanceof AbsencePreviewError && error.reason === 'invalid_period');
});

test('horas usam minutos reais; workdays não inventa jornada nem quantidade', () => {
  const hour = previewAbsenceRequest({ ...input, unit: 'hour', startDate: '2026-10-20', endDate: '2026-10-21', startTime: '22:30', endTime: '02:00' }, baseType, target, '2026-10-14');
  assert.equal(hour.quantity.value, 3.5);
  assert.ok(hour.pending.includes('hour_schedule_unverified'));
  const scheduled = { ...baseType, policies: [{ ...basePolicy, calculation: 'scheduled_workdays' }] } as DPAbsenceType;
  const preview = previewAbsenceRequest(input, scheduled, target, '2026-10-14');
  assert.equal(preview.quantity.value, null);
  assert.ok(preview.pending.includes('scheduled_workdays_unavailable'));
});

test('bloqueia PJ, empate, arquivado, unidade, aviso, retroatividade e teto', () => {
  assert.throws(() => previewAbsenceRequest(input, baseType, { ...target, employmentRelationshipType: 'pj' }, '2026-10-14'));
  assert.throws(() => previewAbsenceRequest(input, { ...baseType, status: 'archived' }, target, '2026-10-14'));
  assert.throws(() => previewAbsenceRequest({ ...input, unit: 'hour', startTime: '10:00', endTime: '11:00' }, { ...baseType, requestUnits: ['day'] }, target, '2026-10-14'));
  assert.throws(() => previewAbsenceRequest(input, { ...baseType, policies: [basePolicy, { ...basePolicy, id: 'rule-2' }] }, target, '2026-10-14'), (error) => error instanceof AbsencePreviewError && error.reason === 'ambiguous');
  assert.throws(() => previewAbsenceRequest(input, { ...baseType, policies: [{ ...basePolicy, minimumNoticeDays: 7 }] }, target, '2026-10-14'), (error) => error instanceof AbsencePreviewError && error.reason === 'notice');
  assert.throws(() => previewAbsenceRequest({ ...input, startDate: '2026-10-13', endDate: '2026-10-13' }, baseType, target, '2026-10-14'), (error) => error instanceof AbsencePreviewError && error.reason === 'retroactive');
  assert.throws(() => previewAbsenceRequest(input, { ...baseType, policies: [{ ...basePolicy, maxUnitsPerRequest: 2 }] }, target, '2026-10-14'), (error) => error instanceof AbsencePreviewError && error.reason === 'maximum');
});

test('dia de envio segue America/Belem', () => {
  assert.equal(belemCivilDate(new Date('2026-10-15T02:59:00Z')), '2026-10-14');
  assert.equal(belemCivilDate(new Date('2026-10-15T03:00:00Z')), '2026-10-15');
});
