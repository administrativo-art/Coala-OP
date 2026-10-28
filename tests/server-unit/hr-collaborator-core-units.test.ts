import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCollaboratorCore } from '@/features/hr/lib/collaborator-core.server';

test('edição mantém referência financeira separada das unidades operacionais', async () => {
  const result = await resolveCollaboratorCore({ unitId: 'financial-b', unitIds: ['operation-a'], assignedKioskIds: ['kiosk-a'] }, {
    currentUser: { unitId: 'financial-a', unitIds: ['operation-a'] }, syncProfile: false,
  });
  assert.equal(result.userPatch.unitId, 'financial-b');
  assert.deepEqual(result.userPatch.unitIds, ['operation-a']);
  assert.deepEqual(result.unitIds, ['operation-a']);
});

test('onboarding legado com apenas unitId conserva unidade inicial', async () => {
  const result = await resolveCollaboratorCore({ unitId: 'initial-unit' }, { syncProfile: false });
  assert.equal(result.userPatch.unitId, 'initial-unit');
  assert.deepEqual(result.userPatch.unitIds, ['initial-unit']);
});

test('lista operacional vazia explícita não é restaurada do cadastro anterior', async () => {
  const result = await resolveCollaboratorCore({ unitId: 'financial-b', unitIds: [] }, {
    currentUser: { unitId: 'financial-a', unitIds: ['operation-a'] }, syncProfile: false,
  });
  assert.equal(result.userPatch.unitId, 'financial-b');
  assert.deepEqual(result.userPatch.unitIds, []);
  assert.deepEqual(result.unitIds, []);
});
