import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const source = (path: string) => readFile(new URL(path, root), 'utf8');

test('solicitação vincula instalação ao UID autenticado e não aceita proprietário informado pelo cliente', async () => {
  const [schema, server] = await Promise.all([
    source('src/features/mobile/corporate-device/schemas.ts'),
    source('src/features/mobile/corporate-device/server.ts'),
  ]);
  assert.doesNotMatch(schema, /ownerUid/);
  assert.match(server, /ownerUid: actor\.decoded\.uid/);
  assert.match(server, /CORPORATE_DEVICE_ALREADY_OWNED/);
  assert.match(server, /devicePublicKey: input\.devicePublicKey/);
});

test('aprovação substitui outro aparelho ativo do mesmo usuário e gera auditoria', async () => {
  const server = await source('src/features/mobile/corporate-device/server.ts');
  assert.match(server, /where\('status', '==', 'active'\)/);
  assert.match(server, /status: 'replaced', replacedByDeviceId: ref\.id/);
  assert.match(server, /device_\$\{targetStatus\}/);
  assert.match(server, /permissions\.settings\.manageUsers/);
});

test('rotas exigem sessão ativa, atestação mobile e contrato seguro', async () => {
  const [mobile, admin] = await Promise.all([
    source('src/app/api/mobile/corporate-device/route.ts'),
    source('src/app/api/users/[userId]/corporate-devices/route.ts'),
  ]);
  assert.match(mobile, /assertOfficialMobileApp/);
  assert.match(mobile, /export const POST = secureRoute/);
  assert.match(admin, /export const GET = secureRoute/);
  assert.match(admin, /export const POST = secureRoute/);
  assert.match(admin, /authorization:manage-users/);
});

test('vínculo automático fica limitado à Heucilene e o perfil não oferece solicitação pública', async () => {
  const [server, profile, viewModel] = await Promise.all([
    source('src/features/mobile/corporate-device/server.ts'),
    source('apps/coala-one-android/app/src/main/java/com/coalaone/go/MainActivity.kt'),
    source('apps/coala-one-android/app/src/main/java/com/coalaone/go/ui/CorporateDeviceViewModel.kt'),
  ]);
  assert.match(server, /actor\.decoded\.uid !== AUTO_ENROLL_OWNER_UID/);
  assert.match(server, /CORPORATE_DEVICE_REQUEST_FORBIDDEN/);
  assert.match(server, /CORPORATE_DEVICE_ALREADY_ACTIVE/);
  assert.match(viewModel, /result\.autoEnrollAllowed && result\.device == null/);
  assert.match(profile, /val corporateDevice: CorporateDeviceViewModel = hiltViewModel\(\)/);
  assert.match(profile, /LaunchedEffect\(corporateDevice\) \{ corporateDevice\.load\(\) \}/);
  assert.doesNotMatch(profile, /Vincular este aparelho empresarial|Solicitar novo vínculo/);
});

test('Visualizar como não oferece batida nem preserva tentativa offline', async () => {
  const [screen, viewModel, authServer] = await Promise.all([
    source('apps/coala-one-android/app/src/main/java/com/coalaone/go/ui/TimeScreens.kt'),
    source('apps/coala-one-android/app/src/main/java/com/coalaone/go/ui/TimeViewModel.kt'),
    source('src/lib/auth-server.ts'),
  ]);
  assert.match(screen, /section != "today" \|\| viewAsActive/);
  assert.match(screen, /val canPunch = !viewAsActive/);
  assert.match(viewModel, /require\(developerViewAsStore\.current\(\) == null\)/);
  assert.match(authServer, /if \(!isDeveloperViewAsReadMethod\(req\.method\)\)/);
});
