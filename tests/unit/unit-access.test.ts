import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAccessAnyUnit,
  canDelegateUnitAccess,
  canAccessUnit,
  canAccessUserByUnit,
  filterUnitsByAccess,
  getLinkedUnitIds,
  resolveUnitAccess,
} from '../../src/lib/unit-access';

test('mantém o comportamento legado quando o escopo não foi gravado', () => {
  const user = {
    unitIds: ['dp-joao-paulo'],
    assignedKioskIds: ['joao-paulo', 'tirirical'],
  };

  assert.deepEqual(getLinkedUnitIds(user), ['dp-joao-paulo', 'joao-paulo', 'tirirical']);
  assert.deepEqual(resolveUnitAccess(user), {
    scope: 'linked',
    allUnits: false,
    unitIds: ['dp-joao-paulo', 'joao-paulo', 'tirirical'],
  });
});

test('escopo selecionado ignora a lotação e usa somente as unidades escolhidas', () => {
  const user = {
    unitIds: ['matriz'],
    assignedKioskIds: ['matriz'],
    unitAccessScope: 'selected' as const,
    unitAccessUnitIds: ['joao-paulo', 'tirirical', 'tirirical'],
  };

  assert.equal(canAccessUnit(user, 'matriz'), false);
  assert.equal(canAccessUnit(user, 'tirirical'), true);
  assert.deepEqual(resolveUnitAccess(user).unitIds, ['joao-paulo', 'tirirical']);
});

test('escopo global e administrador padrão acessam qualquer unidade', () => {
  assert.equal(canAccessUnit({ assignedKioskIds: [], unitAccessScope: 'all' }, 'nova-unidade'), true);
  assert.equal(canAccessUnit({ assignedKioskIds: [] }, 'nova-unidade', { isDefaultAdmin: true }), true);
});

test('usuário sem unidade não recebe acesso implícito', () => {
  assert.equal(canAccessUnit({ assignedKioskIds: [] }, 'tirirical'), false);
  assert.deepEqual(filterUnitsByAccess(
    [{ id: 'joao-paulo' }, { id: 'tirirical' }],
    { assignedKioskIds: [] },
  ), []);
});

test('a visibilidade de um colaborador compara o escopo do ator com a lotação do alvo', () => {
  const actor = {
    unitIds: ['matriz'],
    unitAccessScope: 'selected' as const,
    unitAccessUnitIds: ['tirirical'],
  };

  assert.equal(canAccessAnyUnit(actor, ['joao-paulo', 'tirirical']), true);
  assert.equal(canAccessUserByUnit(actor, { unitIds: ['tirirical'] }), true);
  assert.equal(canAccessUserByUnit(actor, { unitIds: ['matriz'] }), false);
});

test('um gestor não pode delegar escopo maior que o próprio', () => {
  const actor = {
    unitAccessScope: 'selected' as const,
    unitAccessUnitIds: ['joao-paulo', 'tirirical'],
  };

  assert.equal(canDelegateUnitAccess(actor, {
    unitAccessScope: 'selected',
    unitAccessUnitIds: ['tirirical'],
  }), true);
  assert.equal(canDelegateUnitAccess(actor, {
    unitAccessScope: 'selected',
    unitAccessUnitIds: ['shopping-da-ilha'],
  }), false);
  assert.equal(canDelegateUnitAccess(actor, { unitAccessScope: 'all' }), false);
});
