import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileReleaseForPackage, mobileReleaseQuerySchema } from '../../src/lib/mobile-app-release';
import { COALA_GO_RELEASE } from '../../src/lib/mobile-app-release';
import { COALA_APP_INSTALLERS } from '../../src/lib/signage';

test('default version and download now select the only mobile app, Coala Go', () => {
  const expected = { ...COALA_GO_RELEASE, packagePath: COALA_APP_INSTALLERS.mobile.packagePath };
  assert.deepEqual(mobileReleaseForPackage(), expected);
  assert.deepEqual(mobileReleaseForPackage('coalaone.go'), expected);
  assert.equal(expected.packagePath, '/app/CoalaGo.apk');
  assert.equal(expected.minVersionCode, expected.versionCode);
});

test('withdrawn legacy package never receives the Go installer', () => {
  assert.equal(mobileReleaseForPackage('com.coalaone.notas').packagePath, null);
  const selected = mobileReleaseForPackage('coalaone.go');
  selected.versionCode = 100;
  assert.equal(mobileReleaseForPackage('coalaone.go').versionCode, COALA_GO_RELEASE.versionCode);
});

test('package selection rejects unsupported apps and unknown query fields', () => {
  assert.equal(mobileReleaseQuerySchema.safeParse({}).success, true);
  assert.equal(mobileReleaseQuerySchema.safeParse({ packageName: 'coalaone.go' }).success, true);
  assert.equal(mobileReleaseQuerySchema.safeParse({ packageName: 'evil' }).success, false);
  assert.equal(mobileReleaseQuerySchema.safeParse({ packageName: 'coalaone.go', redirect: '//evil' }).success, false);
  assert.throws(() => mobileReleaseForPackage('evil'));
});
