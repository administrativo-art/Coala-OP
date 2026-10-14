import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { COALA_GO_RELEASE, COALA_GO_APK_SHA256 } from '../../src/lib/mobile-app-release';
import { COALA_APP_INSTALLERS } from '../../src/lib/signage';

const native = 'apps/coala-one-android/app/';
test('Coala Go version, native project and downloadable APK remain synchronized', async () => {
  const gradle = await readFile(`${native}build.gradle.kts`, 'utf8');
  assert.ok(gradle.includes(`configured("COALA_VERSION_CODE", "${COALA_GO_RELEASE.versionCode}")`));
  assert.ok(gradle.includes(`configured("COALA_VERSION_NAME", "${COALA_GO_RELEASE.versionName}")`));
  assert.match(gradle, /applicationId = "coalaone.go"/);
  assert.match(gradle, /minSdk = 26/);
  const apk = await readFile(`public${COALA_APP_INSTALLERS.mobile.packagePath}`);
  assert.equal(createHash('sha256').update(apk).digest('hex'), COALA_GO_APK_SHA256);
  await assert.rejects(access('apps/coala-notas'));
  await assert.rejects(access('public/app/CoalaMobile.apk'));
  const page = await readFile('src/components/signage/signage-app-install.tsx', 'utf8');
  assert.match(page, /Baixar Coala Go/);
  assert.doesNotMatch(page, /Coala Mobile APP|No aplicativo Coala One|Abra o Coala One/);
});

test('native updater validates ranges, package and public signing identity before installation', async () => {
  const source = await readFile(`${native}src/main/java/com/coalaone/go/data/AppUpdater.kt`, 'utf8');
  assert.match(source, /header\("Range", "bytes=/);
  assert.match(source, /response.code == 206/);
  assert.match(source, /archive.packageName == context.packageName/);
  assert.match(source, /signatures\(archive\) == signatures\(installed\)/);
  const activity = await readFile(`${native}src/main/java/com/coalaone/go/MainActivity.kt`, 'utf8');
  assert.match(activity, /application\/vnd.android.package-archive/);
});

test('native icons exist and simulation remains debug-only', async () => {
  for (const name of ['coala_icon', 'coala_foreground']) {
    const image = await readFile(`${native}src/main/res/drawable/${name}.png`);
    assert.deepEqual([...image.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  }
  const login = await readFile(`${native}src/main/java/com/coalaone/go/ui/AuthScreens.kt`, 'utf8');
  assert.match(login, /if \(BuildConfig.DEBUG\) TextButton\(vm::simulate\)/);
  assert.match(login, /PasswordVisualTransformation/);
});
