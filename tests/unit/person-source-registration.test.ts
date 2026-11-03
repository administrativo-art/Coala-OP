import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function check(diff: string) {
  const dir = mkdtempSync(join(tmpdir(), 'person-source-'));
  try {
    const file = join(dir, 'diff.txt'); writeFileSync(file, diff);
    return spawnSync(process.execPath, ['scripts/check-person-source-registration.mjs', '--diff-file', file], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('new personal collection without registry fails', () => {
  const result = check('+++ b/src/features/new-person.server.ts\n+await db.collection("newPersonalRecords").doc(id).set(data);\n');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /newPersonalRecords sem classificação/);
});
test('registered person source succeeds and dynamic source outside collector fails', () => {
  assert.equal(check('+++ b/src/features/new-person.server.ts\n+await db.collection("generatedDocuments").doc(id).set(data);\n').status, 0);
  assert.equal(check('+++ b/src/features/new-person.server.ts\n+await db.collection(name).get();\n').status, 1);
  assert.equal(check('+++ b/src/features/new-person.server.ts\n+await db.collection(\n+  "newPersonalRecords"\n+).get();\n').status, 1);
  assert.equal(check('+++ b/src/features/new-person.server.ts\n+await db.collection(`newPersonalRecords`).get();\n').status, 1);
});
test('descriptor without policy is rejected before diff classification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-registry-'));
  try {
    const registry = join(dir, 'registry.ts'); const diff = join(dir, 'diff.txt');
    writeFileSync(registry, readFileSync('src/features/privacy/person-inventory.ts', 'utf8').replace(/permissionPolicy: "people", /, ''));
    writeFileSync(diff, '+++ b/src/fixture.ts\n+await db.collection("users").get();\n');
    const result = spawnSync(process.execPath, ['scripts/check-person-source-registration.mjs', '--diff-file', diff, '--registry-file', registry], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /falta permissionPolicy/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('modular collection/group, aliases and templates require classification; registered imports pass', () => {
  for (const call of ['collection(db, "newPersonalRecords")', 'collectionGroup(db, "newPersonalRecords")', 'records(db, `newPersonalRecords`)', 'collection(db, `new${name}`)', 'fb.collection(db, "newPersonalRecords")']) {
    assert.equal(check(`+++ b/src/new.ts\n+import { collection, collectionGroup, collection as records } from 'firebase/firestore';\n+import * as fb from 'firebase/firestore';\n+${call};\n`).status, 1, call);
  }
  assert.equal(check(`+++ b/src/new.ts\n+import { collection as records, collectionGroup } from 'firebase/firestore';\n+records(db, 'generatedDocuments');\n+collectionGroup(db, 'employeeDocuments');\n`).status, 0);
});
test('dynamic waiver is limited to exact approved collector read call and rejects a writer in that file', () => {
  const file = '+++ b/src/features/privacy/person-inventory.server.ts\n';
  const collector = readFileSync('src/features/privacy/person-inventory.server.ts', 'utf8');
  assert.equal(check(file + collector.split('\n').map((line) => '+' + line).join('\n')).status, 0);
  assert.equal(check(file + '+export async function collectPersonSource() { return await db.collection(source.collection).add(data); }\n').status, 1);
  assert.equal(check(file + '+export async function writer() { return await db.collection(source.collection).add(data); }\n').status, 1);
  assert.equal(check(file + '+export async function collectPersonSource() { return await db.collection(otherCollection).get(); }\n').status, 1);
});


test('descriptor enums are validated with the same SOURCE_VALUES used by runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-enum-'));
  try {
    const registry = join(dir, 'registry.ts'), diff = join(dir, 'diff.txt');
    writeFileSync(diff, '+++ b/src/fixture.ts\n+await db.collection("users").get();\n');
    for (const field of ['permissionPolicy', 'scopePolicy', 'database', 'role', 'retention']) {
      const original = readFileSync('src/features/privacy/person-inventory.ts', 'utf8');
      writeFileSync(registry, original.replace(new RegExp(`${field}: "[^"]+"`), `${field}: "unknown"`));
      const result = spawnSync(process.execPath, ['scripts/check-person-source-registration.mjs', '--diff-file', diff, '--registry-file', registry], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, /desconhecido/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
