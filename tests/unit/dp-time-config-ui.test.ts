import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applicabilityLabel,
  buildJourneyDays,
  formatCalendarDateBR,
  formatValidityBR,
  formatDuration,
  journeyCycleMatchesWeeklyLoad,
  journeyDistributionLabel,
  journeyRegimeDescription,
  journeyRegimeLabel,
  maskDurationInput,
  monthlyWorkloadMinutes,
  parseCycleLengthDaysInput,
  parseDuration,
  weeklyRestPlacementLabel,
} from '../../src/lib/dp-time-config-ui';

test('duração de jornada preserva minutos e aceita carga semanal acima de 24h', () => {
  assert.equal(parseDuration('44:00'), 2640);
  assert.equal(parseDuration('7:20'), 440);
  assert.equal(parseDuration('07:60'), null);
  assert.equal(formatDuration(440), '07:20');
  assert.equal(monthlyWorkloadMinutes(44 * 60), 220 * 60);
  assert.equal(formatDuration(monthlyWorkloadMinutes(44 * 60)), '220:00');
});

test('DSR móvel não apresenta o sétimo slot como domingo fixo', () => {
  const restDay = { dayIndex: 7, plannedMinutes: 0, isRestDay: true };
  assert.equal(weeklyRestPlacementLabel({ placement: 'schedule', maxConsecutiveWorkDays: 6 }), 'Definido na escala');
  assert.equal(journeyDistributionLabel(restDay, 7, { placement: 'schedule', maxConsecutiveWorkDays: 6 }, 6, 1), 'DSR móvel 1');
  assert.equal(journeyDistributionLabel(restDay, 7, { placement: 'fixed_cycle', maxConsecutiveWorkDays: 6 }, 6, 1), '7 · Dom');
});

test('vigência é apresentada no padrão brasileiro sem converter fuso', () => {
  assert.equal(formatCalendarDateBR('2026-10-13'), '13/10/2026');
  assert.equal(formatValidityBR('2026-10-13'), '13/10/2026 em diante');
  assert.equal(formatValidityBR('2026-10-13', '2027-02-05'), '13/10/2026 a 05/02/2027');
});

test('campos de jornada formatam horas e permitem dias do ciclo vazios durante a digitação', () => {
  assert.equal(maskDurationInput('4400'), '44:00');
  assert.equal(maskDurationInput('16800'), '168:00');
  assert.equal(maskDurationInput('44:00'), '44:00');
  assert.equal(parseCycleLengthDaysInput(''), null);
  assert.equal(parseCycleLengthDaysInput('7'), 7);
  assert.equal(parseCycleLengthDaysInput('42'), 42);
  assert.equal(parseCycleLengthDaysInput('43'), null);
});

test('ciclo de seis dias de 7h20 e um descanso equivale a 44h semanais', () => {
  const days = buildJourneyDays(7).map((day, index) => ({
    ...day,
    plannedMinutes: index < 6 ? 440 : 0,
    isRestDay: index === 6,
  }));
  assert.equal(journeyCycleMatchesWeeklyLoad(2640, 7, days), true);
  assert.equal(journeyCycleMatchesWeeklyLoad(2400, 7, days), false);
});

test('regime ausente mantém jornadas antigas no modo fixo', () => {
  assert.equal(journeyRegimeLabel(undefined), 'Fixa');
  assert.match(journeyRegimeDescription(undefined), /turno escalado/);
  assert.equal(journeyRegimeLabel({ mode: 'fixed' }), 'Fixa');
  assert.equal(journeyRegimeLabel({ mode: 'flexible' }), 'Flexível');
});

test('rótulo de abrangência expõe escopo e refinamentos sem alterar cadastro', () => {
  const label = applicabilityLabel({
    scope: { kind: 'unit_group', id: 'grupo-1' },
    jobRoleIds: ['cargo-1'],
    collaboratorIds: ['pessoa-1', 'pessoa-2'],
  }, { unitGroupNames: new Map([['grupo-1', 'São Luís']]) });
  assert.equal(label, 'São Luís · 1 cargo(s) · 2 pessoa(s)');
  assert.equal(applicabilityLabel(
    { scope: { kind: 'unit_organization', id: 'organizacao-1' } },
    { unitOrganizationNames: new Map([['organizacao-1', 'Maranhão']]) },
  ), 'Maranhão');
});
