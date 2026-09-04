import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEditRhProfilesFromPermissions,
  resolveRhRoleFromPermissions,
} from '../../functions/src/rh/access-policy';

test('reconhece administrador pelo perfil mesmo sem cache ou rh_role explícito', () => {
  assert.equal(resolveRhRoleFromPermissions({
    profilePermissions: { settings: { manageUsers: true } },
  }), 'admin');
});

test('reconhece administrador pelo claim padrão', () => {
  assert.equal(resolveRhRoleFromPermissions({ tokenIsDefaultAdmin: true }), 'admin');
});

test('reconhece gestor pelas permissões atuais de colaboradores', () => {
  assert.equal(resolveRhRoleFromPermissions({
    profilePermissions: { dp: { collaborators: { edit: true } } },
  }), 'manager');
});

test('preserva rh_role explícito e nega perfil sem acesso', () => {
  assert.equal(resolveRhRoleFromPermissions({
    profilePermissions: { dp: { rh_role: 'employee' } },
  }), 'employee');
  assert.equal(resolveRhRoleFromPermissions({ profilePermissions: {} }), null);
});

test('visualização isolada não concede edição de perfis', () => {
  const permissions = { dp: { collaborators: { view: true, edit: false } } };
  assert.equal(resolveRhRoleFromPermissions({ profilePermissions: permissions }), 'manager');
  assert.equal(canEditRhProfilesFromPermissions({ profilePermissions: permissions }), false);
});

test('edição atual de colaboradores e papel legado de gestor concedem escrita', () => {
  assert.equal(canEditRhProfilesFromPermissions({
    profilePermissions: { dp: { collaborators: { edit: true } } },
  }), true);
  assert.equal(canEditRhProfilesFromPermissions({
    userPermissions: { dp: { rh_role: 'manager' } },
  }), true);
});
