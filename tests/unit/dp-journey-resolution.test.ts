import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDPJourneySchedule } from '../../src/features/dp/journey-validation/core';
import { resolveDPJourney } from '../../src/lib/dp-journey-resolution';
import type { DPJourney, DPTimeApplicability } from '../../src/types';

function journey(id: string, applicability: DPTimeApplicability, overrides: Partial<DPJourney> = {}): DPJourney {
  return {
    id,
    lineageId: id,
    version: 1,
    status: 'published',
    name: id,
    weeklyMinutes: 2_640,
    cycleLengthDays: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      plannedMinutes: index === 6 ? 0 : 440,
      isRestDay: index === 6,
    })),
    regime: { mode: 'fixed' },
    weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 6 },
    scaleValidation: { mode: 'consecutive_days' },
    applicability,
    validFrom: '2026-01-01',
    createdAt: {} as DPJourney['createdAt'],
    createdBy: 'test',
    updatedAt: {} as DPJourney['updatedAt'],
    updatedBy: 'test',
    ...overrides,
  };
}

const target = {
  collaboratorId: 'person-1',
  jobRoleId: 'role-1',
  jobFunctionIds: ['function-1'],
  unitId: 'unit-1',
  unitGroupId: 'group-1',
  unitOrganizationId: 'organization-1',
};

test('resolve jornada pela hierarquia colaborador > função > cargo > organização', () => {
  const journeys = [
    journey('company', { scope: { kind: 'company' } }),
    journey('organization', { scope: { kind: 'unit_organization', id: 'organization-1' } }),
    journey('role', { scope: { kind: 'company' }, jobRoleIds: ['role-1'] }),
    journey('function', { scope: { kind: 'company' }, jobFunctionIds: ['function-1'] }),
    journey('person', { scope: { kind: 'company' }, collaboratorIds: ['person-1'] }),
  ];

  const resolution = resolveDPJourney({ journeys, target, date: '2026-10-13' });
  assert.equal(resolution.status, 'resolved');
  if (resolution.status === 'resolved') {
    assert.equal(resolution.journey.id, 'person');
    assert.equal(resolution.resolvedBy, 'collaborator');
  }
});

test('sinaliza empate na mesma granularidade em vez de escolher silenciosamente', () => {
  const resolution = resolveDPJourney({
    journeys: [
      journey('role-a', { scope: { kind: 'company' }, jobRoleIds: ['role-1'] }),
      journey('role-b', { scope: { kind: 'company' }, jobRoleIds: ['role-1'] }),
    ],
    target,
    date: '2026-10-13',
  });
  assert.equal(resolution.status, 'ambiguous');
});

test('resolve abrangência organizacional de colaborador multiunidade sem unidade primária', () => {
  const resolution = resolveDPJourney({
    journeys: [journey('multiunit', {
      scope: { kind: 'unit_organization', id: 'organization-1' },
      jobFunctionIds: ['function-1'],
    })],
    target: {
      collaboratorId: 'person-1',
      jobFunctionIds: ['function-1'],
      unitIds: ['unit-1', 'unit-2'],
      unitGroupIds: ['group-1', 'group-2'],
      unitOrganizationIds: ['organization-1'],
    },
    date: '2026-10-13',
  });
  assert.equal(resolution.status, 'resolved');
  if (resolution.status === 'resolved') assert.equal(resolution.journey.id, 'multiunit');
});

test('mantém a contagem 6x1 entre competências e unidades', () => {
  const shifts = [
    ...['2026-09-28', '2026-09-29', '2026-09-30'].map((date, index) => ({
      id: `old-${index}`,
      userId: 'person-1',
      date,
      type: 'work' as const,
      unitId: index === 1 ? 'unit-2' : 'unit-1',
    })),
    ...['2026-10-01', '2026-10-02', '2026-10-03'].map((date, index) => ({
      id: `current-${index}`,
      userId: 'person-1',
      date,
      type: 'work' as const,
      unitId: index === 2 ? 'unit-2' : 'unit-1',
    })),
  ];
  const result = validateDPJourneySchedule({
    journeys: [journey('6x1', { scope: { kind: 'company' } })],
    people: { 'person-1': target },
    shifts,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    historyFrom: '2026-08-01',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.people['person-1'].carryInConsecutiveDays, 3);
  assert.equal(result.people['person-1'].countsByDate['2026-10-03'], 6);
  assert.deepEqual(result.people['person-1'].predictedDayOffDates, ['2026-10-04']);
});

test('bloqueia o sétimo dia e jornada ainda marcada para revisão manual', () => {
  const sevenDays = Array.from({ length: 7 }, (_, index) => ({
    id: `shift-${index}`,
    userId: 'person-1',
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    type: 'work' as const,
    unitId: 'unit-1',
  }));
  const exceeded = validateDPJourneySchedule({
    journeys: [journey('6x1', { scope: { kind: 'company' } })],
    people: { 'person-1': target },
    shifts: sevenDays,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    historyFrom: '2026-08-01',
  });
  assert.equal(exceeded.status, 'blocked');
  assert.equal(exceeded.issues.some((issue) => issue.code === 'MAX_CONSECUTIVE_DAYS_EXCEEDED' && issue.date === '2026-10-07'), true);

  const manual = validateDPJourneySchedule({
    journeys: [journey('12x36', { scope: { kind: 'company' } }, {
      cycleLengthDays: 2,
      weeklyMinutes: 2_520,
      days: [
        { dayIndex: 1, plannedMinutes: 720, isRestDay: false },
        { dayIndex: 2, plannedMinutes: 0, isRestDay: true },
      ],
      scaleValidation: { mode: 'manual_review' },
      weeklyRest: { placement: 'fixed_cycle', maxConsecutiveWorkDays: 1 },
    })],
    people: { 'person-1': target },
    shifts: [sevenDays[0]],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    historyFrom: '2026-08-01',
  });
  assert.equal(manual.status, 'blocked');
  assert.equal(manual.people['person-1'].status, 'manual_review');
});

test('validação bloqueia turno restrito a outra jornada', () => {
  const result = validateDPJourneySchedule({
    journeys: [journey('jornada-v2', { scope: { kind: 'company' } })],
    people: { 'person-1': target },
    shifts: [{
      id: 'turno-escalado', userId: 'person-1', date: '2026-10-01', type: 'work',
      unitId: 'unit-1', shiftDefinitionId: 'turno-1',
    }],
    shiftDefinitions: { 'turno-1': { journeyIds: ['outra-jornada'] } },
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    historyFrom: '2026-08-01',
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.issues.some((issue) => issue.code === 'SHIFT_NOT_ALLOWED'), true);
});

test('expediente menor só bloqueia quando a jornada desativa a prevalência do turno definido', () => {
  const base = {
    people: { 'person-1': target },
    shifts: [{
      id: 'turno-escalado', userId: 'person-1', date: '2026-10-01', type: 'work' as const,
      unitId: 'unit-1', shiftDefinitionId: 'turno-1',
    }],
    shiftDefinitions: {
      'turno-1': {
        startTime: '08:00', endTime: '14:00', breakType: 'fixed' as const,
        breakStart: '11:45', breakEnd: '12:00',
      },
    },
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    historyFrom: '2026-08-01',
  };
  const blocked = validateDPJourneySchedule({
    ...base,
    journeys: [journey('jornada-v2', { scope: { kind: 'company' } }, { useDefinedShiftWhenShorter: false })],
  });
  assert.equal(blocked.issues.some((issue) => issue.code === 'SHIFT_SHORTER_THAN_JOURNEY'), true);

  const allowed = validateDPJourneySchedule({
    ...base,
    journeys: [journey('jornada-v2', { scope: { kind: 'company' } }, { useDefinedShiftWhenShorter: true })],
  });
  assert.equal(allowed.issues.some((issue) => issue.code === 'SHIFT_SHORTER_THAN_JOURNEY'), false);
});
