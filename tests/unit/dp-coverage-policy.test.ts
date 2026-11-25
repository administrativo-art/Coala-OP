import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coverageResolutionField, dpCoverageDecision, isCoveragePolicyActive } from '../../src/lib/dp-coverage-policy';
import { buildDPShiftReference } from '../../src/lib/dp-shift-reference';
import { completeJourneySchema, updateJourneySchema } from '../../src/features/dp/time-config/schemas';
import type { DPJourney } from '../../src/types';

const LIDER = 'AY7PsLQaQbanA8OAjOwG';
const ATENDENTE_CARGO = 'xwihJDpc8eGsTNDIebOc';
const journey = {
  id: 'j40', lineageId: 'l40', version: 2, name: 'Jornada 40h | 8h diárias', validFrom: '2026-12-01',
  weeklyMinutes: 2400, cycleLengthDays: 7, days: [{ dayIndex: 1, plannedMinutes: 480, isRestDay: false }],
  useDefinedShiftWhenShorter: true, toleranceMinutes: 5,
  coveragePolicy: { jobRoleIds: [], jobFunctionIds: [LIDER] },
} as unknown as DPJourney;

describe('Política de jornada de cobertura', () => {
  it('entra pela função ou pelo cargo; quem não tem nenhum dos dois fica fora', () => {
    assert.deepEqual(dpCoverageDecision(journey, { jobRoleId: ATENDENTE_CARGO, jobFunctionIds: [LIDER] }),
      { applies: true, matchedBy: 'job_function', journeyId: 'j40', journeyVersion: 2 });
    assert.equal(dpCoverageDecision(journey, { jobRoleId: ATENDENTE_CARGO, jobFunctionIds: ['atendente-balcao'] }), null);
    const byRole = { ...journey, coveragePolicy: { jobRoleIds: [ATENDENTE_CARGO], jobFunctionIds: [] } };
    assert.equal(dpCoverageDecision(byRole, { jobRoleId: ATENDENTE_CARGO, jobFunctionIds: [] })?.matchedBy, 'job_role');
  });

  it('sem "Usar o expediente definido no turno" a política fica inativa', () => {
    const off = { ...journey, useDefinedShiftWhenShorter: false };
    assert.equal(isCoveragePolicyActive(off), false);
    assert.equal(dpCoverageDecision(off, { jobFunctionIds: [LIDER] }), null);
    assert.equal(isCoveragePolicyActive({ ...journey, coveragePolicy: { jobRoleIds: [], jobFunctionIds: [] } }), false);
    assert.equal(isCoveragePolicyActive({ ...journey, coveragePolicy: undefined }), false);
  });

  it('congela a decisão na referência do turno e no journeyResolution, sem mudar a forma das antigas', () => {
    const base = { collaboratorId: 'euclid', resolvedBy: 'company' as const, definition: null, executionUnitId: 'tirirical',
      date: '2026-12-01', startTime: '09:00', endTime: '15:15', capturedAt: '2026-11-25T12:00:00.000Z' };
    const leader = buildDPShiftReference({ ...base, journey, user: { jobRoleId: ATENDENTE_CARGO, jobFunctionIds: [LIDER] } });
    assert.equal(leader.coverage?.matchedBy, 'job_function');
    assert.deepEqual(leader.journey.coveragePolicy, { jobRoleIds: [], jobFunctionIds: [LIDER] });
    assert.deepEqual(coverageResolutionField(leader), { coverage: leader.coverage });

    const legacyJourney = { ...journey, coveragePolicy: undefined };
    const attendant = buildDPShiftReference({ ...base, journey: legacyJourney, user: { jobRoleId: ATENDENTE_CARGO, jobFunctionIds: [] } });
    assert.equal('coverage' in attendant, false);
    assert.equal('coveragePolicy' in attendant.journey, false);
    assert.deepEqual(coverageResolutionField(attendant), {});

    // Mudar o cadastro depois não altera a decisão já congelada.
    journey.coveragePolicy!.jobFunctionIds.length = 0;
    assert.equal(leader.coverage?.applies, true);
    assert.deepEqual(leader.journey.coveragePolicy, { jobRoleIds: [], jobFunctionIds: [LIDER] });
    journey.coveragePolicy!.jobFunctionIds.push(LIDER);
  });

  it('o cadastro da jornada aceita a política e recusa campos estranhos', () => {
    const shape = completeJourneySchema.innerType().shape.coveragePolicy;
    assert.equal(shape.safeParse({ jobRoleIds: [], jobFunctionIds: [LIDER] }).success, true);
    assert.equal(shape.safeParse(undefined).success, true);
    assert.equal(shape.safeParse({ jobRoleIds: [], jobFunctionIds: [LIDER], extra: true }).success, false);
  });

  it('editar o rascunho com a política vazia envia null, que apaga o campo na mescla', () => {
    assert.equal(updateJourneySchema.safeParse({ action: 'update', data: { coveragePolicy: null } }).success, true);
    assert.equal(updateJourneySchema.safeParse({ action: 'update',
      data: { coveragePolicy: { jobRoleIds: [], jobFunctionIds: [LIDER] } } }).success, true);
  });
});
