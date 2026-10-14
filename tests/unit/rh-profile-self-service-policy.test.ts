import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROFILE_ACCESS_MATRIX,
  canEditField,
  canRequestFieldChange,
  type FieldMapEntry,
} from '../../src/types/rh';

function field(policy: FieldMapEntry['self_service_policy']): FieldMapEntry {
  return {
    bizneo_id: 'coala_internal',
    label: 'Telefone',
    section: 'Contato',
    type: 'text',
    visibility: 'public',
    employee_visible: true,
    employee_editable: false,
    self_service_policy: policy,
    order: 10,
  };
}

const ownerContext = { isOwner: true };

test('política do campo separa alteração direta de solicitação sujeita à aprovação', () => {
  assert.equal(canEditField(field('direct'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), true);
  assert.equal(canRequestFieldChange(field('direct'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);

  assert.equal(canEditField(field('approval'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);
  assert.equal(canRequestFieldChange(field('approval'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), true);

  assert.equal(canEditField(field('blocked'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);
  assert.equal(canRequestFieldChange(field('blocked'), 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);
});

test('política do titular não concede acesso a campo oculto pela matriz', () => {
  const confidential = { ...field('direct'), visibility: 'confidential' as const };
  assert.equal(canEditField(confidential, 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);
  assert.equal(canRequestFieldChange({ ...confidential, self_service_policy: 'approval' }, 'employee', ownerContext, DEFAULT_PROFILE_ACCESS_MATRIX), false);
});
