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

test('organização do quiosque vem da unidade ou, sem ela, do grupo da unidade', async () => {
  const { mapKioskOrganizations, NO_ORGANIZATION_NAME } = await import('../../../src/lib/goals-groups');
  const kiosks = [{ id: 'k1', name: 'Quiosque Tirirical' }, { id: 'k2', name: 'Quiosque João Paulo' }, { id: 'k3', name: 'Quiosque Shopping do Automóvel' }];
  const units = [
    { id: 'u1', name: 'Tirirical', organizationId: 'o1' },
    { id: 'u2', name: 'João Paulo', groupId: 'g1' },
    { id: 'u3', name: 'Shopping do Automóvel' },
  ] as unknown as DPUnit[];
  const map = mapKioskOrganizations(kiosks, units, [{ id: 'g1', organizationId: 'o1' }], [{ id: 'o1', name: 'Regional São Luís' }]);
  assert.equal(map.get('k1')!.name, 'Regional São Luís');
  assert.equal(map.get('k2')!.name, 'Regional São Luís');
  assert.equal(map.get('k3')!.name, NO_ORGANIZATION_NAME);
  assert.deepEqual(listKioskGroups(map).map((g) => [g.name, g.kioskIds]), [['Regional São Luís', ['k1', 'k2']], [NO_ORGANIZATION_NAME, ['k3']]]);
});
