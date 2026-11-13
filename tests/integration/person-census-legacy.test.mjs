import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId: PROJECT });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
function run(flags) { return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT, '--workspace', 'coala', ...flags], { encoding: 'utf8', env: process.env }); }
function output(result) { assert.equal(result.status, 0, result.stderr); const outDir = JSON.parse(result.stdout.trim()).outDir; return { outDir, manifest: JSON.parse(readFileSync(`${outDir}/manifest.json`, 'utf8')), raw: readFileSync(`${outDir}/census.jsonl`, 'utf8') }; }

test('deployment-scoped identities feed bounded legacy document discovery without textual matching', async () => {
  await dbAdmin.collection('users').doc('legacy-u').set({ hrEmployeeId: 'legacy-e', recruitmentCandidateId: 'legacy-c', email: 'hidden@example.test', cpf: 'hidden' });
  await hrDbAdmin.collection('employees').doc('legacy-e').set({ auth_uid: 'legacy-u', name: 'hidden name' });
  await hrDbAdmin.collection('candidates').doc('legacy-c').set({ name: 'hidden name' });
  await hrDbAdmin.collection('onboardingProcesses').doc('legacy-p').set({ candidateId: 'legacy-c', collaboratorUserId: 'legacy-u', email: 'hidden@example.test' });
  await dbAdmin.collection('generatedDocuments').doc('legacy-d').set({ employeeId: 'legacy-u', version: 2, content: 'hidden document' });
  await hrDbAdmin.collection('employeeDocuments').doc('legacy-ed').set({ employeeId: 'legacy-e', content: 'hidden document' });
  await hrDbAdmin.collection('hrSignatureRequests').doc('legacy-s').set({ onboardingId: 'legacy-p', purpose: 'onboarding', content: 'hidden document' });
  const dirs = [];
  try {
    const identity = output(run(['--legacy-deployment', '--sources', 'main/users,hr/employees,hr/candidates', '--page-size', '2', '--max-reads-per-source', '20', '--max-pages-per-source', '15']));
    dirs.push(identity.outDir);
    assert.equal(identity.manifest.status, 'complete');
    assert.equal(identity.manifest.globalCoverage, 'incomplete');
    assert.equal(identity.manifest.sources.every((source) => source.scopeField === 'legacy-deployment'), true);
    assert.equal(identity.raw.split('\n').filter(Boolean).length, 3);
    assert.equal(identity.raw.split('\n').filter(Boolean).every((line) => JSON.parse(line).scopeEvidence === 'legacy-deployment'), true);
    assert.equal(/hidden|email|cpf|content/.test(identity.raw), false);
    assert.equal(identity.manifest.sha256, createHash('sha256').update(identity.raw).digest('hex'));
    const documents = output(run(['--legacy-deployment', '--discover-legacy-document-targets', '--identity-run', identity.outDir,
      '--sources', 'main/generatedDocuments,hr/employeeDocuments,hr/hrSignatureRequests,hr/onboardingProcesses',
      '--page-size', '2', '--max-reads-per-source', '20', '--max-discovery-reads', '100', '--max-discovery-queries', '100', '--max-targets', '50']));
    dirs.push(documents.outDir);
    assert.equal(documents.manifest.status, 'complete', JSON.stringify(documents.manifest.gaps));
    for (const id of ['legacy-d', 'legacy-ed', 'legacy-s', 'legacy-p']) assert.equal(documents.raw.includes(`"id":"${id}"`), true, id);
    assert.equal(/hidden|email|cpf|content/.test(documents.raw), false);
    const dry = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', `${documents.outDir}/census.jsonl`, '--manifest', `${documents.outDir}/manifest.json`, '--report', `${documents.outDir}/dry.json`], { encoding: 'utf8', env: process.env });
    assert.equal(dry.status, 0, dry.stderr);
    const report = JSON.parse(readFileSync(`${documents.outDir}/dry.json`, 'utf8'));
    assert.equal(report.patches.some((patch) => patch.id === 'legacy-d' && patch.add.includes('main.users:legacy-u')), true);
    assert.equal(report.patches.some((patch) => patch.id === 'legacy-ed' && patch.add.includes('hr.employees:legacy-e')), true);
    assert.equal(report.patches.some((patch) => patch.id === 'legacy-s' && patch.add.includes('hr.candidates:legacy-c')), true);
    assert.equal((await dbAdmin.collection('generatedDocuments').doc('legacy-d').get()).get('subjectKeys'), undefined);
    await dbAdmin.collection('generatedDocuments').doc('legacy-conflict').set({ employeeId: 'legacy-u', subjectKeys: ['main.users:alien'] });
    const conflict = output(run(['--legacy-deployment', '--discover-legacy-document-targets', '--identity-run', identity.outDir,
      '--sources', 'main/generatedDocuments,hr/employeeDocuments,hr/hrSignatureRequests,hr/onboardingProcesses',
      '--page-size', '2', '--max-reads-per-source', '20', '--max-discovery-reads', '100', '--max-discovery-queries', '100', '--max-targets', '50']));
    dirs.push(conflict.outDir);
    assert.equal(conflict.manifest.status, 'incomplete');
    assert.equal(conflict.raw.includes('legacy-conflict'), false);
    assert.ok(conflict.manifest.targeted.reasons.subject_conflict >= 1);
    assert.notEqual(run(['--legacy-deployment', '--sources', 'financial/expenses']).status, 0);
    const wrongWorkspace = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', PROJECT, '--workspace', 'other', '--legacy-deployment', '--sources', 'main/users'], { encoding: 'utf8', env: process.env });
    assert.notEqual(wrongWorkspace.status, 0);
    const wrongProject = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-census-export.mjs', '--project', 'demo-other', '--workspace', 'coala', '--legacy-deployment', '--sources', 'main/users'], { encoding: 'utf8', env: process.env });
    assert.notEqual(wrongProject.status, 0);
    await dbAdmin.collection('users').doc('legacy-foreign').set({ workspaceId: 'other' });
    const foreign = output(run(['--legacy-deployment', '--sources', 'main/users', '--max-reads-per-source', '20']));
    dirs.push(foreign.outDir);
    assert.equal(foreign.manifest.status, 'incomplete');
    assert.equal(foreign.raw.includes('legacy-foreign'), false);
    const input = `${identity.outDir}/census.jsonl`;
    const original = readFileSync(input, 'utf8');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(input, `${original}${original.split('\n')[0]}\n`, { mode: 0o600 });
    const tampered = run(['--legacy-deployment', '--discover-legacy-document-targets', '--identity-run', identity.outDir,
      '--sources', 'main/generatedDocuments,hr/employeeDocuments,hr/hrSignatureRequests,hr/onboardingProcesses']);
    assert.notEqual(tampered.status, 0);
  } finally { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); }
});
