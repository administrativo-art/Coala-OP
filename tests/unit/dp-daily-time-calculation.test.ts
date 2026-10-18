import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateDailyTime, type DailyTimeInput } from '../../src/features/dp/time-calculation/core';
import type { DPShiftReference } from '../../src/lib/dp-shift-reference';

function fixture(): DailyTimeInput {
  const period = {
    validFrom: '2026-10-01', employmentRelationshipType: 'clt' as const,
    employerUnitId: 'employer-a', unitId: 'unit-a', unitIds: ['unit-a'],
    jobFunctionIds: [], sourceDocumentId: 'doc-a', sourceReason: 'Contrato declarado',
    employer: { unitId: 'employer-a', unitName: 'Operação A', cnpj: '12345678000195',
      address: 'Rua A', identityStatus: 'catalog_identifiers_consistent_unverified' as const },
    jobRoleName: null, jobFunctionNames: [],
  };
  const reference: DPShiftReference = {
    schemaVersion: 1 as const, source: 'dp_schedule_write' as const, collaboratorId: 'person-a',
    capturedAt: '2026-10-01T00:00:00.000Z', basisCapturedAt: '2026-10-01T00:00:00.000Z',
    plannedDate: '2026-10-19', executionUnitId: 'unit-a', plannedStartTime: '09:00', plannedEndTime: '16:00',
    collaborator: { unitId: 'unit-a', unitIds: ['unit-a'], jobRoleId: null, jobRoleName: null,
      jobFunctionIds: [], jobFunctionNames: [], employmentCycleVersion: null,
      employmentCycleStatus: 'pending' as const, employmentRelationshipType: 'clt', employmentStatus: null,
      isActive: true, admissionDate: null, terminationDate: null, employerUnitId: 'employer-a',
      employerCnpj: '12345678000195', fiscalStatus: 'present_unverified' as const },
    journey: { id: 'journey-a', lineageId: 'lineage-a', version: 1, name: '7h20',
      resolvedBy: 'collaborator' as const, validFrom: '2026-10-19', validTo: null,
      weeklyMinutes: 2640, cycleLengthDays: 7,
      days: [{ dayIndex: 1, plannedMinutes: 440, isRestDay: false },
        ...[2, 3, 4, 5, 6].map((dayIndex) => ({ dayIndex, plannedMinutes: 440, isRestDay: false })),
        { dayIndex: 7, plannedMinutes: 0, isRestDay: true }],
      regime: { mode: 'fixed' as const }, weeklyRest: { placement: 'fixed_cycle' as const, maxConsecutiveWorkDays: 6 },
      scaleValidation: { mode: 'consecutive_days' as const }, expectedBreakMinutes: 60,
      useDefinedShiftWhenShorter: null, allowedShiftDefinitionIds: ['definition-a'] },
    shiftDefinition: { id: 'definition-a', code: null, name: '6 horas', startTime: '09:00', endTime: '16:00',
      breakType: 'fixed' as const, breakStart: '12:00', breakEnd: '13:00', breakDurationMinutes: null,
      breakWindowStart: null, breakWindowEnd: null, overnight: false, expectedPunches: null,
      daysOfWeek: [], unitId: null, unitIds: [], journeyIds: [], bizneoTemplateId: null,
      description: null, updatedAt: null },
  };
  return {
    userId: 'person-a', workDate: '2026-10-19',
    employment: { status: 'matched', historyId: 'history-a', revision: 1, date: '2026-10-19', period },
    shifts: [{ shiftId: 'shift-a', referenceRevisionId: 'reference-a', reference }],
    overtimePolicy: { status: 'resolved', policy: { id: 'policy-a', version: 1, status: 'published',
      validFrom: '2026-10-01', timeBank: { enabled: true, allowNegativeBalance: true,
        expiredBalanceDestination: 'review' }, externalCoverageRule: 'origin' } },
    workedIntervals: [{ id: 'work-a', workDate: '2026-10-19', start: '2026-10-19T09:00:00-03:00',
      end: '2026-10-19T15:00:00-03:00', executionUnitId: 'unit-a' }],
  };
}

describe('daily time simulation', () => {
  it('proposes one -80 bank debit against 440 reference, preserving employer', () => {
    const result = calculateDailyTime(fixture());
    assert.equal(result.status, 'calculated');
    assert.deepEqual(result.summary, { referenceMinutes: 440, plannedShiftMinutes: 360,
      workedMinutes: 360, deltaMinutes: -80 });
    assert.deepEqual(result.movement, { destination: 'time_bank', kind: 'debit', minutes: -80 });
    assert.equal(result.provenance.employerUnitId, 'employer-a');
    assert.equal(result.complianceStatus, 'simulation_only');
  });

  it('consolidates sequential cross-unit coverage without replacing employer', () => {
    const input = fixture();
    const second = structuredClone(input.shifts[0]);
    second.shiftId = 'shift-b'; second.referenceRevisionId = 'reference-b';
    second.reference.executionUnitId = 'unit-b';
    second.reference.plannedStartTime = '12:00'; second.reference.plannedEndTime = '15:00';
    second.reference.shiftDefinition!.startTime = '12:00'; second.reference.shiftDefinition!.endTime = '15:00';
    second.reference.shiftDefinition!.breakType = 'none';
    second.reference.shiftDefinition!.breakStart = null; second.reference.shiftDefinition!.breakEnd = null;
    input.shifts[0].reference.plannedEndTime = '12:00';
    input.shifts[0].reference.shiftDefinition!.endTime = '12:00';
    input.shifts[0].reference.shiftDefinition!.breakType = 'none';
    input.shifts[0].reference.shiftDefinition!.breakStart = null;
    input.shifts[0].reference.shiftDefinition!.breakEnd = null;
    input.shifts.push(second);
    input.workedIntervals = [
      { id: 'work-a', workDate: '2026-10-19', start: '2026-10-19T09:00:00-03:00', end: '2026-10-19T12:00:00-03:00', executionUnitId: 'unit-a' },
      { id: 'work-b', workDate: '2026-10-19', start: '2026-10-19T12:00:00-03:00', end: '2026-10-19T15:00:00-03:00', executionUnitId: 'unit-b' },
    ];
    const result = calculateDailyTime(input);
    assert.equal(result.status, 'calculated');
    assert.deepEqual(result.summary, { referenceMinutes: 440, plannedShiftMinutes: 360, workedMinutes: 360, deltaMinutes: -80 });
    assert.equal(result.provenance.employerUnitId, 'employer-a');
    const reversed = structuredClone(input);
    reversed.shifts.reverse(); reversed.workedIntervals.reverse();
    assert.equal(calculateDailyTime(reversed).sourceKey, result.sourceKey);
    reversed.employment = { ...reversed.employment, revision: 2 } as typeof reversed.employment;
    assert.notEqual(calculateDailyTime(reversed).sourceKey, result.sourceKey);
  });

  for (const status of ['missing', 'gap', 'inconsistent'] as const) {
    it(`blocks ${status} employment`, () => {
      const input = fixture();
      input.employment = status === 'missing' ? { status } : status === 'gap'
        ? { status, historyId: 'history-a', revision: 1, date: input.workDate }
        : { status, historyId: 'history-a', revision: 1 };
      assert.equal(calculateDailyTime(input).status, 'review_required');
    });
  }

  it('rejects duplicate and overlapping references or actual intervals', () => {
    const input = fixture();
    input.shifts.push(structuredClone(input.shifts[0]));
    assert.ok(calculateDailyTime(input).issues.includes('SHIFT_REFERENCE_DUPLICATE'));
    input.shifts[1].shiftId = 'shift-b'; input.shifts[1].referenceRevisionId = 'reference-b';
    assert.ok(calculateDailyTime(input).issues.includes('SHIFT_REFERENCE_OVERLAP'));
    input.shifts.pop();
    input.workedIntervals.push({ ...input.workedIntervals[0] });
    assert.ok(calculateDailyTime(input).issues.includes('WORK_INTERVAL_DUPLICATE'));
    input.workedIntervals[1].id = 'work-b';
    assert.ok(calculateDailyTime(input).issues.includes('WORK_INTERVAL_OVERLAP'));
  });

  it('blocks manual, missing/ambiguous policy, absence, no punch and positive work', () => {
    const input = fixture();
    input.shifts[0].reference.journey.scaleValidation = { mode: 'manual_review' };
    assert.ok(calculateDailyTime(input).issues.includes('JOURNEY_MANUAL_REVIEW'));
    input.shifts[0].reference.journey.scaleValidation = { mode: 'consecutive_days' };
    input.overtimePolicy = { status: 'none' };
    assert.ok(calculateDailyTime(input).issues.includes('POLICY_MISSING'));
    input.overtimePolicy = { status: 'ambiguous' };
    assert.ok(calculateDailyTime(input).issues.includes('POLICY_AMBIGUOUS'));
    input.overtimePolicy = fixture().overtimePolicy;
    input.absenceAdjustments = [{ id: 'absence-a' }];
    assert.ok(calculateDailyTime(input).issues.includes('ABSENCE_REQUIRES_REVIEW'));
    input.absenceAdjustments = [];
    input.workedIntervals = [];
    assert.ok(calculateDailyTime(input).issues.includes('WORK_INTERVAL_MISSING'));
    input.workedIntervals = fixture().workedIntervals;
    input.workedIntervals[0].end = '2026-10-19T17:00:00-03:00';
    assert.ok(calculateDailyTime(input).issues.includes('POSITIVE_DELTA_REQUIRES_REVIEW'));
    input.workedIntervals[0].end = '2026-10-19T16:20:00-03:00';
    assert.deepEqual({ status: calculateDailyTime(input).status, movement: calculateDailyTime(input).movement },
      { status: 'calculated', movement: null });
  });

  it('uses fixed-cycle index and schedule only with one positive load', () => {
    const input = fixture();
    input.workDate = '2026-10-25';
    input.shifts[0].reference.plannedDate = input.workDate;
    input.employment = { ...input.employment, date: input.workDate } as typeof input.employment;
    input.workedIntervals[0].workDate = input.workDate;
    input.workedIntervals[0].start = '2026-10-25T09:00:00-03:00';
    input.workedIntervals[0].end = '2026-10-25T15:00:00-03:00';
    assert.equal(calculateDailyTime(input).summary.referenceMinutes, 0);
    input.shifts[0].reference.journey.weeklyRest = { placement: 'schedule', maxConsecutiveWorkDays: 6 };
    assert.equal(calculateDailyTime(input).summary.referenceMinutes, 440);
    input.shifts[0].reference.journey.days[1].plannedMinutes = 360;
    input.shifts[0].reference.journey.weeklyMinutes = 2560;
    assert.ok(calculateDailyTime(input).issues.includes('JOURNEY_SCHEDULE_AMBIGUOUS'));
  });

  it('blocks external execution when policy needs territorial review', () => {
    const input = fixture();
    input.workedIntervals[0].executionUnitId = 'unit-b';
    if (input.overtimePolicy.status === 'resolved') input.overtimePolicy.policy.externalCoverageRule = 'execution_unit';
    assert.ok(calculateDailyTime(input).issues.includes('EXTERNAL_COVERAGE_REQUIRES_REVIEW'));
  });

  it('rejects an interval assigned to another civil day and accepts an effective archived policy', () => {
    const input = fixture();
    input.workedIntervals[0].workDate = '2026-10-20';
    assert.ok(calculateDailyTime(input).issues.includes('WORK_INTERVAL_INVALID'));
    input.workedIntervals[0].workDate = input.workDate;
    if (input.overtimePolicy.status === 'resolved') {
      input.overtimePolicy.policy.status = 'archived';
      input.overtimePolicy.policy.validTo = input.workDate;
    }
    const result = calculateDailyTime(input);
    assert.equal(result.status, 'calculated');
    assert.equal(result.movement?.minutes, -80);
  });

  it('fails closed instead of throwing on malformed array entries', () => {
    const input = fixture();
    input.shifts.push(null as unknown as DailyTimeInput['shifts'][number]);
    input.workedIntervals.push(null as unknown as DailyTimeInput['workedIntervals'][number]);
    assert.doesNotThrow(() => calculateDailyTime(input));
    const result = calculateDailyTime(input);
    assert.equal(result.status, 'review_required');
    assert.equal(result.movement, null);
  });
});
