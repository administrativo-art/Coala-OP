import assert from 'node:assert/strict';
import test from 'node:test';

import { listKioskGroups, mapKioskGroups, NO_GROUP_ID } from '../../../src/lib/goals-groups';
import type { DPUnit } from '../../../src/types';

const unit = (id: string, name: string, groupId?: string) => ({ id, name, groupId }) as unknown as DPUnit;

test('agrupa quiosques pelo grupo da unidade do DP, com "Sem grupo" por último', () => {
  const kiosks = [{ id: 'k1', name: 'Quiosque Tirirical' }, { id: 'k2', name: 'Quiosque João Paulo' }, { id: 'k3', name: 'Quiosque Shopping do Automóvel' }];
  const units = [unit('u1', 'Tirirical', 'g1'), unit('u2', 'João Paulo', 'g1'), unit('u3', 'Shopping do Automóvel')];
  const map = mapKioskGroups(kiosks, units, [{ id: 'g1', name: 'Quiosques de rua' }]);
  assert.equal(map.get('k1')!.name, 'Quiosques de rua');
  assert.equal(map.get('k3')!.id, NO_GROUP_ID);
  const groups = listKioskGroups(map);
  assert.deepEqual(groups.map(g => [g.name, g.kioskIds]), [['Quiosques de rua', ['k1', 'k2']], ['Sem grupo', ['k3']]]);
});
