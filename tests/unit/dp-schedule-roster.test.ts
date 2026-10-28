import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDPHabitualRoster } from '../../src/lib/dp-schedule-roster';
import type { DPUnit, Kiosk, User } from '../../src/types';

const units = [
  { id: 'jp', name: 'Quiosque João Paulo' },
  { id: 'tirirical', name: 'Quiosque Tirirical' },
] as DPUnit[];

test('a equipe habitual não herda vínculo de uma cobertura lançada no JP', () => {
  const people = [
    { id: 'habitual', unitIds: ['jp'], assignedKioskIds: [] },
    { id: 'cobertura', unitIds: ['tirirical'], assignedKioskIds: [] },
  ] satisfies Array<Pick<User, 'id' | 'unitIds' | 'assignedKioskIds'>>;

  // Mesmo quando a pessoa de Tirirical tem turno ou DSR no JP, esses lançamentos
  // não são entradas do cadastro operacional usado para montar a equipe habitual.
  const roster = buildDPHabitualRoster(units, people, units, []);
  assert.deepEqual(roster.get('jp'), ['habitual']);
  assert.deepEqual(roster.get('tirirical'), ['cobertura']);
});

test('o quiosque atribuído também constitui vínculo operacional habitual', () => {
  const person = [{ id: 'quiosque', unitIds: [], assignedKioskIds: ['kiosk-jp'] }] satisfies Array<Pick<User, 'id' | 'unitIds' | 'assignedKioskIds'>>;
  const kiosks = [{ id: 'kiosk-jp', name: 'Quiosque João Paulo' }] as Kiosk[];
  const roster = buildDPHabitualRoster(units, person, units, kiosks);

  assert.deepEqual(roster.get('jp'), ['quiosque']);
  assert.deepEqual(roster.get('tirirical'), []);
});
