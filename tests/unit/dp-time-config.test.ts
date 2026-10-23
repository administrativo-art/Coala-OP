import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJourneySchema,
  createOvertimePolicySchema,
  createShiftDefinitionSchema,
  updateJourneySchema,
  updateOvertimePolicySchema,
  updateShiftDefinitionSchema,
} from '../../src/features/dp/time-config/schemas';
import { applicabilityOverlaps, applicabilityScopeCollection, applicabilitySpecificity, changedShiftBizneoIdentity, isShiftDefinitionCompatibleWithJourney, previousCalendarDate, validityOverlaps } from '../../src/lib/dp-time-config-rules';

const journey = {
  name: 'Jornada 44 horas',
  weeklyMinutes: 2640,
  cycleLengthDays: 7,
  days: [1, 2, 3, 4, 5, 6].map((dayIndex) => ({ dayIndex, plannedMinutes: 440, isRestDay: false })).concat([{ dayIndex: 7, plannedMinutes: 0, isRestDay: true }]),
  applicability: { scope: { kind: 'unit_group' as const, id: 'norte' }, jobRoleIds: ['atendimento'] },
  validFrom: '2026-01-01',
};

test('jornada exige distribuição coerente com a carga semanal e vigência válida', () => {
  const withDefaultRegime = createJourneySchema.safeParse(journey);
  assert.equal(withDefaultRegime.success, true);
  assert.deepEqual(withDefaultRegime.success ? withDefaultRegime.data.regime : null, { mode: 'fixed' });
  assert.deepEqual(withDefaultRegime.success ? withDefaultRegime.data.weeklyRest : null, { placement: 'fixed_cycle', maxConsecutiveWorkDays: 6 });
  assert.deepEqual(withDefaultRegime.success ? withDefaultRegime.data.scaleValidation : null, { mode: 'consecutive_days' });
  assert.equal(createJourneySchema.safeParse({ ...journey, weeklyMinutes: 2400 }).success, false);
  assert.equal(createJourneySchema.safeParse({ ...journey, validTo: '2025-12-31' }).success, false);
  assert.equal(createJourneySchema.safeParse({ ...journey, validFrom: '2026-02-30' }).success, false);
  assert.equal(createJourneySchema.safeParse({ ...journey, validFrom: '2028-02-29' }).success, true);
});

test('tolerância única da jornada vai de 0 a 10 minutos e é opcional', () => {
  assert.equal(createJourneySchema.safeParse({ ...journey, toleranceMinutes: 5 }).success, true);
  assert.equal(createJourneySchema.safeParse({ ...journey, toleranceMinutes: 0 }).success, true);
  assert.equal(createJourneySchema.safeParse({ ...journey, toleranceMinutes: 11 }).success, false);
  assert.equal(createJourneySchema.safeParse({ ...journey, toleranceMinutes: -1 }).success, false);
  assert.equal(createJourneySchema.safeParse({ ...journey, toleranceMinutes: 2.5 }).success, false);
});

test('12x36 permanece cadastrável sem fingir validação automática', () => {
  const twelveByThirtySix = {
    ...journey,
    weeklyMinutes: 2520,
    cycleLengthDays: 2,
    days: [
      { dayIndex: 1, plannedMinutes: 720, isRestDay: false },
      { dayIndex: 2, plannedMinutes: 0, isRestDay: true },
    ],
    weeklyRest: { placement: 'fixed_cycle' as const, maxConsecutiveWorkDays: 1 },
  };
  assert.equal(createJourneySchema.safeParse(twelveByThirtySix).success, false);
  assert.equal(createJourneySchema.safeParse({
    ...twelveByThirtySix,
    scaleValidation: { mode: 'manual_review' },
  }).success, true);
});

test('DSR pode ter posição fixa ou ser definido na escala sem presumir domingo', () => {
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 6, sundayCadenceWeeks: 3 },
  }).success, true);
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 7 },
  }).success, false);
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    days: journey.days.map((day) => ({ ...day, plannedMinutes: 440, isRestDay: false })),
    weeklyMinutes: 3080,
  }).success, false);
});

test('jornada versiona o regime fixo ou flexível sem criar cadastro separado', () => {
  assert.equal(createJourneySchema.safeParse({ ...journey, regime: { mode: 'fixed' } }).success, true);
  assert.equal(createJourneySchema.safeParse({ ...journey, regime: { mode: 'legacy_bizneo' } }).success, false);
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    regime: { mode: 'flexible', windowStart: '06:00', windowEnd: '22:00' },
  }).success, true);
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    regime: { mode: 'flexible', windowStart: '06:00' },
  }).success, false);
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    regime: { mode: 'fixed', windowStart: '06:00', windowEnd: '22:00' },
  }).success, false);
});

test('jornada configura quando o expediente menor definido no turno pode prevalecer', () => {
  const parsed = createJourneySchema.parse({
    ...journey,
    expectedBreakMinutes: 60,
    useDefinedShiftWhenShorter: true,
  });
  assert.equal(parsed.expectedBreakMinutes, 60);
  assert.equal(parsed.useDefinedShiftWhenShorter, true);
  assert.equal(createJourneySchema.safeParse({ ...journey, expectedBreakMinutes: 481 }).success, false);
});

test('configuração de tempo aceita e valida organização como abrangência', () => {
  assert.equal(createJourneySchema.safeParse({
    ...journey,
    applicability: { scope: { kind: 'unit_organization', id: 'organizacao-norte' } },
  }).success, true);
  assert.equal(applicabilityScopeCollection({ kind: 'unit_organization', id: 'organizacao-norte' }), 'dp_unitOrganizations');
});

test('alteração separa edição de rascunho das transições de publicação', () => {
  assert.equal(updateJourneySchema.safeParse({ action: 'publish' }).success, true);
  assert.equal(updateJourneySchema.safeParse({ action: 'archive' }).success, true);
  assert.equal(updateJourneySchema.safeParse({ action: 'update', data: { name: 'Nova versão' } }).success, true);
  assert.equal(updateJourneySchema.safeParse({ action: 'update', data: {} }).success, false);
  assert.equal(updateJourneySchema.safeParse({
    action: 'update',
    data: { description: null, validTo: null, allowedShiftDefinitionIds: null },
  }).success, true);
  assert.equal(updateOvertimePolicySchema.safeParse({
    action: 'update',
    data: {
      description: null,
      collectiveAgreementReference: null,
      validTo: null,
      dailyOvertimeLimitMinutes: null,
      weeklyOvertimeLimitMinutes: null,
    },
  }).success, true);
});

test('política de hora extra persiste regras sem aceitar banco desativado como destino', () => {
  const policy = {
    name: 'CCT Belém 2026',
    applicability: { scope: { kind: 'unit_group' as const, id: 'belem' } },
    validFrom: '2026-01-01',
    categories: [{ id: 'he60', name: 'Hora extra 60%', trigger: 'workday' as const, ratePercent: 60, destination: 'payroll' as const, requiresApproval: true }],
    timeBank: { enabled: false, allowNegativeBalance: false, expiredBalanceDestination: 'review' as const },
    externalCoverageRule: 'origin' as const,
  };
  assert.equal(createOvertimePolicySchema.safeParse(policy).success, true);
  // A tolerância é única e fica na jornada; a política não a aceita mais.
  assert.equal(createOvertimePolicySchema.safeParse({ ...policy, dailyToleranceMinutes: 10 }).success, false);
  // Ciclo do banco: unidade e tamanho guardados; em meses vai até 12 e o marco até o dia 28.
  const withCycle = (cycle: Record<string, unknown>) => createOvertimePolicySchema.safeParse({ ...policy, timeBank: { ...policy.timeBank, enabled: true, cycle } }).success;
  assert.equal(withCycle({ unit: 'day', length: 15, anchorDate: '2026-01-01', residualDestination: 'carry' }), true);
  assert.equal(withCycle({ unit: 'month', length: 6, anchorDate: '2026-01-10', residualDestination: 'payroll' }), true);
  assert.equal(withCycle({ unit: 'month', length: 13, anchorDate: '2026-01-10', residualDestination: 'payroll' }), false);
  assert.equal(withCycle({ unit: 'month', length: 1, anchorDate: '2026-01-31', residualDestination: 'review' }), false);
  assert.equal(withCycle({ unit: 'day', length: 0, anchorDate: '2026-01-01', residualDestination: 'forfeit' }), false);
  assert.equal(createOvertimePolicySchema.safeParse({
    ...policy,
    categories: [{ ...policy.categories[0], destination: 'time_bank', bankCreditFactor: 1 }],
  }).success, false);
  assert.equal(createOvertimePolicySchema.safeParse({
    ...policy,
    categories: [{ ...policy.categories[0], trigger: 'specific_weekdays', weekdays: [1, 3, 5] }],
  }).success, true);
  assert.equal(createOvertimePolicySchema.safeParse({
    ...policy,
    categories: [{ ...policy.categories[0], trigger: 'specific_weekdays' }],
  }).success, false);
  const legacy = createOvertimePolicySchema.safeParse({
    ...policy,
    categories: [{ ...policy.categories[0], startsAfterMinutes: 30 }],
  });
  assert.equal(legacy.success, true);
  if (legacy.success) assert.equal('startsAfterMinutes' in legacy.data.categories[0], false);
});

test('abrangência só é ambígua no mesmo nível quando filtros e vigências se cruzam', () => {
  const groupRole = { scope: { kind: 'unit_group' as const, id: 'belem' }, jobRoleIds: ['operador'] };
  assert.equal(applicabilityOverlaps(groupRole, { ...groupRole, jobRoleIds: ['operador', 'lider'] }), true);
  assert.equal(applicabilityOverlaps(groupRole, { ...groupRole, jobRoleIds: ['financeiro'] }), false);
  assert.equal(applicabilityOverlaps(groupRole, { scope: { kind: 'unit' as const, id: 'loja-1' }, jobRoleIds: ['operador'] }), false);
  assert.equal(validityOverlaps({ validFrom: '2026-01-01', validTo: '2026-06-30' }, { validFrom: '2026-06-30' }), true);
  assert.equal(validityOverlaps({ validFrom: '2026-01-01', validTo: '2026-06-29' }, { validFrom: '2026-06-30' }), false);
  assert.equal(previousCalendarDate('2027-01-01'), '2026-12-31');
  assert.equal(previousCalendarDate('2026-03-01'), '2026-02-28');
  assert.equal(
    applicabilitySpecificity({ scope: { kind: 'company' }, jobFunctionIds: ['atendimento'] }).score
      > applicabilitySpecificity({ scope: { kind: 'unit', id: 'loja-1' }, jobRoleIds: ['operador'] }).score,
    true,
  );
  assert.equal(
    applicabilitySpecificity({ scope: { kind: 'company' }, collaboratorIds: ['maria'] }).score
      > applicabilitySpecificity({ scope: { kind: 'unit', id: 'loja-1' }, jobFunctionIds: ['atendimento'] }).score,
    true,
  );
});

test('turno mantém o contrato Bizneo, exige intervalo e aceita somente metadados opcionais do Coala', () => {
  const parsed = createShiftDefinitionSchema.parse({
    code: '#1234', name: 'Manhã Bizneo', bizneoTemplateId: '9988',
    startTime: '08:00', endTime: '16:00', daysOfWeek: [1, 2, 3, 4, 5, 6],
    journeyIds: ['jornada-44h'], description: 'Turno operacional padrão', expectedPunches: 4,
    breakType: 'flexible', breakDurationMinutes: 60,
  });
  assert.equal(parsed.code, '#1234');
  assert.equal(parsed.name, 'Manhã Bizneo');
  assert.equal(parsed.bizneoTemplateId, '9988');
  assert.deepEqual(parsed.journeyIds, ['jornada-44h']);
  assert.equal(updateShiftDefinitionSchema.safeParse({ expectedPunches: null }).success, true);
  assert.equal(updateShiftDefinitionSchema.safeParse({ isArchived: true }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, isArchived: true }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({
    ...parsed,
    breakType: 'fixed', breakStart: '12:00', breakEnd: '13:00',
  }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({
    ...parsed,
    breakType: 'flexible', breakDurationMinutes: 60,
  }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({
    ...parsed,
    breakType: 'staggered', breakDurationMinutes: 60, breakWindowStart: '11:00', breakWindowEnd: '14:00',
  }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, breakType: 'fixed' }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, breakType: 'flexible', breakDurationMinutes: undefined }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, breakType: 'staggered', breakDurationMinutes: 60 }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, breakType: 'none' }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, breakType: undefined, breakDurationMinutes: undefined }).success, false);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, executionUnitPolicy: 'scheduled', locationTrackingPolicy: 'punch_only' }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, executionUnitPolicy: 'free', locationTrackingPolicy: 'workday' }).success, true);
  assert.equal(createShiftDefinitionSchema.safeParse({ ...parsed, executionUnitPolicy: 'scheduled', locationTrackingPolicy: 'workday' }).success, false);
  assert.deepEqual(changedShiftBizneoIdentity(parsed, { code: '#1234', name: 'Manhã Bizneo', bizneoTemplateId: '9988' }), []);
  assert.deepEqual(changedShiftBizneoIdentity(parsed, { name: 'Outro nome', bizneoTemplateId: null }), ['name', 'bizneoTemplateId']);
});

test('compatibilidade aplica as restrições opcionais da jornada e do turno em conjunto', () => {
  assert.equal(isShiftDefinitionCompatibleWithJourney({
    journeyId: 'jornada-v2', shiftDefinitionId: 'turno-1',
  }), true);
  assert.equal(isShiftDefinitionCompatibleWithJourney({
    journeyId: 'jornada-v2', journeyAllowedShiftDefinitionIds: ['turno-2'], shiftDefinitionId: 'turno-1',
  }), false);
  assert.equal(isShiftDefinitionCompatibleWithJourney({
    journeyId: 'jornada-v2', shiftDefinitionId: 'turno-1', shiftJourneyIds: ['jornada-v1'],
  }), false);
  assert.equal(isShiftDefinitionCompatibleWithJourney({
    journeyId: 'jornada-v2', journeyAllowedShiftDefinitionIds: ['turno-1'],
    shiftDefinitionId: 'turno-1', shiftJourneyIds: ['jornada-v2'],
  }), true);
});
