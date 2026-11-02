import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settings = readFileSync('src/components/access-profiles-settings.tsx', 'utf8');
const modal = readFileSync('src/components/profile-management-modal.tsx', 'utf8');
const provider = readFileSync('src/components/profiles-provider.tsx', 'utf8');
const userManagement = readFileSync('src/components/user-management.tsx', 'utf8');

test('Perfis de acesso abre cadastro pelo CTA e detalhe pela linha inteira', () => {
  assert.match(settings, /onClick=\{\(\) => openManager\("create"\)\}[\s\S]*?Novo perfil/);
  assert.match(settings, /<LiftRow[\s\S]*?onClick=\{\(\) => \{\s*setSelectedProfileId\(profile\.id\)/);
  assert.match(settings, /<SidePanel[\s\S]*?open=\{!!selectedProfile\}/);
  assert.doesNotMatch(settings, /interactive=\{false\}|>\s*Gerenciar perfis\s*</);
});

test('Detalhe preserva consulta e protege ações de escrita e exclusão administrativa', () => {
  assert.match(settings, /\{canEdit \? \([\s\S]*?Copiar perfil[\s\S]*?Editar perfil[\s\S]*?InlineConfirm/);
  assert.match(settings, /selectedIsAdministrator \? \([\s\S]*?não pode ser excluído/);
  assert.match(settings, /\) : <p role="note"[\s\S]*?Você pode consultar este perfil/);
  assert.match(provider, /profileToDelete\?\.isDefaultAdmin \|\| profileId === adminProfileId/);
});

test('Formulário direto e lista legada usam o mesmo modal e mantêm auditoria', () => {
  assert.match(modal, /initialAction = 'manage'/);
  assert.match(modal, /initialAction === 'create'\) handleAddNew\(\)/);
  assert.match(modal, /initialAction === 'edit' && initialProfile\) handleEdit\(initialProfile\)/);
  assert.match(modal, /initialAction === 'duplicate' && initialProfile\) setProfileToDuplicate\(initialProfile\)/);
  assert.match(modal, /profile_created|profile_updated|profile_duplicated|profile_deleted/);
  assert.match(modal, /catch \{\s*setActionError\('Não foi possível salvar o perfil/);
  assert.match(modal, /catch \{\s*setActionError\('Não foi possível copiar o perfil/);
  assert.match(provider, /Error adding profile:[\s\S]*?throw error/);
  assert.match(provider, /Error updating profile:[\s\S]*?throw error/);
  assert.match(userManagement, /<ProfileManagementModal[\s\S]*?canEdit=\{!!permissions\.settings\.manageProfiles\}/);
  assert.doesNotMatch(userManagement, /initialAction=/);
});

test('Coala One e Coala Go usam a mesma navegação recolhível por seção', () => {
  assert.match(modal, /value="app-local-purchase"/);
  assert.match(modal, /value="app-stock"/);
  assert.match(modal, /value="app-goals"/);
  assert.match(modal, /value="app-schedule"/);
  assert.match(modal, /value="app-signage"/);
  assert.doesNotMatch(modal, /<h3 className="pt-2 text-lg font-semibold">Compra local<\/h3>/);
});

test('Lista mostra cargos, funções e usuários vinculados sem abrir o detalhe da linha', () => {
  const links = readFileSync('src/components/access-profile-links.tsx', 'utf8');
  const authProvider = readFileSync('src/components/auth-provider.tsx', 'utf8');
  assert.match(settings, /<span>Cargos e funções<\/span>\s*<span>Usuários<\/span>/);
  assert.match(settings, /role\.isActive === false \|\| !role\.defaultProfileId/);
  assert.match(settings, /fn\.isActive === false \|\| !fn\.defaultProfileId/);
  assert.match(settings, /if \(canSeeUsers\) \{\s*for \(const user of activeUsers\)/);
  assert.match(settings, /canReadUsersDirectory\(permissions\)/);
  assert.match(authProvider, /if \(!canReadUsersDirectory\(permissions\)\)/);
  assert.match(links, /onClick=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*?onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});
