import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

test('migração Google preserva UID e rejeita conta ou provedor pertencente a outro cadastro', async () => {
  const migration = await source('src/features/auth/google-workspace-migration.server.ts');
  assert.match(migration, /deps\.auth\.updateUser\(context\.decoded\.uid/);
  assert.match(migration, /emailOwner\.uid !== context\.decoded\.uid/);
  assert.match(migration, /providerOwner\.uid !== context\.decoded\.uid/);
  assert.match(migration, /linked\.uid !== payload\.sub/);
  assert.match(migration, /revokeRefreshTokens\(context\.decoded\.uid\)/);
  assert.doesNotMatch(migration, /createUser\s*\(/);
});

test('migração exige token Google verificado; Workspace é nominal e Google pessoal exige login recente', async () => {
  const migration = await source('src/features/auth/google-workspace-migration.server.ts');
  assert.match(migration, /verifyIdToken\(\{ idToken, audience: clientId \}\)/);
  assert.match(migration, /payload\.email_verified !== true/);
  assert.match(migration, /payload\.hd\?\.toLowerCase\(\) !== allowedDomain\(\)/);
  assert.match(migration, /nowSeconds - context\.decoded\.auth_time > RECENT_AUTH_SECONDS/);
  assert.match(migration, /!workspaceRequired/);
  assert.match(migration, /snapshot\.get\('corporateGoogleEmail'\)/);
});

test('Coala Go força a migração Workspace autorizada com etapas e progresso visíveis', async () => {
  const activity = await source('apps/coala-one-android/app/src/main/java/com/coalaone/go/MainActivity.kt');
  const viewModel = await source('apps/coala-one-android/app/src/main/java/com/coalaone/go/ui/SessionViewModel.kt');
  assert.match(activity, /googleMigration\.required && !googleMigration\.completed/);
  assert.match(activity, /Registrar ponto agora/);
  assert.match(activity, /migrationPoint -> TimeScreen/);
  assert.match(activity, /Etapa \$\{when/);
  assert.match(activity, /LinearProgressIndicator\(progress = \{ state\.progress/);
  assert.match(viewModel, /progress = \.4f/);
  assert.match(viewModel, /progress = \.78f/);
});

test('rota móvel exige app oficial, contrato seguro e payload estrito', async () => {
  const route = await source('src/app/api/mobile/auth/google-migration/route.ts');
  assert.match(route, /assertOfficialMobileApp\(request, context\.decoded\.uid\)/);
  assert.match(route, /z\.object\(\{ googleIdToken: z\.string\(\)\.min\(100\)\.max\(10_000\) \}\)\.strict\(\)/);
  assert.match(route, /export const GET = secureRoute/);
  assert.match(route, /export const POST = secureRoute/);
  assert.doesNotMatch(route, /replay-protected/);
});

test('autorização administrativa aceita somente domínio corporativo e não pode ser duplicada', async () => {
  const usersRoute = await source('src/app/api/users/[userId]/route.ts');
  assert.match(usersRoute, /\^\[\^\\s@\]\+@coalashakes\\\.com\$/);
  assert.match(usersRoute, /transaction\.get\(dbAdmin\.collection\("users"\)/);
  assert.match(usersRoute, /where\("corporateGoogleEmail", "==", corporateGoogleEmailForUniqueness\)\.limit\(2\)/);
  assert.match(usersRoute, /document\.id !== userId/);
  assert.match(usersRoute, /USER_UPDATE_CORPORATE_GOOGLE_EMAIL_IN_USE/);
});
