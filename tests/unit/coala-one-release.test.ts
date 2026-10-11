import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COALA_ONE_RELEASE } from "../../src/lib/coala-one-release";

test("versão publicada do Coala One bate com a do aplicativo", async () => {
  const { expo } = JSON.parse(await readFile("apps/coala-notas/app.json", "utf8")) as { expo: { version: string; android: { versionCode: number } } };
  // O Android só instala por cima um APK de versionCode maior: o app e o sistema não podem divergir.
  assert.equal(expo.android.versionCode, COALA_ONE_RELEASE.versionCode);
  assert.equal(expo.version, COALA_ONE_RELEASE.versionName);
  assert.ok(COALA_ONE_RELEASE.minVersionCode >= 1 && COALA_ONE_RELEASE.minVersionCode <= COALA_ONE_RELEASE.versionCode);
});

test("atualização do app: o botão usa partes, confere o Content-Range e deixa a assinatura ao Android", async () => {
  const source = await readFile("apps/coala-notas/src/app-update.ts", "utf8");
  assert.match(source, /Range: `bytes=/);
  assert.match(source, /response\.status !== 206/);
  assert.match(source, /application\/vnd\.android\.package-archive/);
});
