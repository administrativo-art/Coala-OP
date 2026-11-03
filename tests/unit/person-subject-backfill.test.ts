import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function manifestFor(input: string, content: string) {
  const path = input.replace(/\.jsonl$/, '.manifest.json');
  writeFileSync(path, JSON.stringify({ schema: 1, mode: 'fixture-readonly', status: 'complete', rows: content.split('\n').filter(Boolean).length,
    sha256: createHash('sha256').update(content).digest('hex'), sources: [], gaps: [] }));
  return path;
}

test('dry-run reports missing references and never writes input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-backfill-'));
  try {
    const input = join(dir, 'input.jsonl'); const report = join(dir, 'report.json');
    const rows = [
      { database: 'main', collection: 'users', id: 'u', data: { hrEmployeeId: 'e', recruitmentCandidateId: 'c' } },
      { database: 'hr', collection: 'employees', id: 'e', data: { auth_uid: 'u' } },
      { database: 'hr', collection: 'candidates', id: 'c', data: {} },
      { database: 'hr', collection: 'onboardingProcesses', id: 'p', data: { source: 'recruitment', candidateId: 'c', collaboratorUserId: 'u' } },
      { database: 'main', collection: 'generatedDocuments', id: 'd', data: { employeeId: 'u', generatedBy: 'other' } },
      { database: 'main', collection: 'generatedDocuments', id: 'pre-account', data: { onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'no-id', data: { employeeName: 'Same Name' } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(input, rows);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifestFor(input, rows), '--report', report, '--page-size', '2'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(input, 'utf8'), rows);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(data.mode, 'dry-run');
    assert.deepEqual(data.patches.find((patch: { id: string }) => patch.id === 'd')?.add, ['main.users:u', 'hr.employees:e', 'hr.candidates:c']);
    assert.deepEqual(data.patches.find((patch: { id: string }) => patch.id === 'pre-account')?.add, ['hr.candidates:c', 'main.users:u', 'hr.employees:e']);
    assert.equal(data.bySource['main/generatedDocuments'].unresolved, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('apply is rejected without explicit emulator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-backfill-'));
  try {
    const input = join(dir, 'input.jsonl'); const report = join(dir, 'report.json'); writeFileSync(input, '');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifestFor(input, ''), '--report', report, '--apply-emulator'], { encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Apply permitido somente/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dry-run refuses JSONL changed after manifest generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-backfill-'));
  try {
    const input = join(dir, 'input.jsonl'); const report = join(dir, 'report.json');
    const rows = JSON.stringify({ database: 'main', collection: 'users', id: 'u', data: {} }) + '\n';
    writeFileSync(input, rows);
    const manifest = manifestFor(input, rows);
    writeFileSync(input, rows + rows);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifest, '--report', report], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSONL diverge do manifesto/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dry-run rejects literal collision, mismatched process and alien existing key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-backfill-'));
  try {
    const input = join(dir, 'input.jsonl'); const report = join(dir, 'report.json');
    const rows = [
      { database: 'main', collection: 'users', id: 'same', data: { hrEmployeeId: 'same' } },
      { database: 'hr', collection: 'employees', id: 'same', data: { auth_uid: 'same', source_user_id: 'other' } },
      { database: 'main', collection: 'users', id: 'u', data: { recruitmentCandidateId: 'c' } },
      { database: 'hr', collection: 'candidates', id: 'c', data: {} },
      { database: 'hr', collection: 'onboardingProcesses', id: 'p', data: { source: 'recruitment', candidateId: 'c', collaboratorUserId: 'u' } },
      { database: 'main', collection: 'generatedDocuments', id: 'collision', data: { employeeId: 'same' } },
      { database: 'main', collection: 'generatedDocuments', id: 'mismatch', data: { employeeId: 'same', onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'alien', data: { employeeId: 'u', subjectKeys: ['main.users:alien'] } },
      { database: 'hr', collection: 'hrSignatureRequests', id: 'frozen', data: { employeeId: 'u', 'personBinding.bindingHash': 'a'.repeat(64) } },
    ];
    writeFileSync(input, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifestFor(input, readFileSync(input, 'utf8')), '--report', report], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(data.patches.some((patch: { id: string }) => ['collision', 'mismatch', 'alien'].includes(patch.id)), false);
    assert.ok(data.conflicts >= 3);
    assert.equal(data.frozenHistory, 1);
    assert.equal(data.patches.some((patch: { id: string }) => patch.id === 'frozen'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing onboarding context reclassifies only candidate-dependent failure and preserves independent UID/HR conflicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'person-backfill-independent-'));
  try {
    const input = join(dir, 'input.jsonl'), report = join(dir, 'report.json');
    const rows = [
      { database: 'main', collection: 'users', id: 'u', data: { hrEmployeeId: 'e', source: 'recruitment_onboarding', onboardingId: 'missing-process', recruitmentCandidateId: 'manual_missing-process' } },
      { database: 'main', collection: 'users', id: 'other-claim', data: { hrEmployeeId: 'e' } },
      { database: 'hr', collection: 'employees', id: 'e', data: { auth_uid: 'wrong-uid', source_user_id: 'u' } },
      { database: 'hr', collection: 'employeeDocuments', id: 'document', data: { employeeId: 'u' } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(input, rows);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifestFor(input, rows), '--report', report], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    assert.deepEqual(data.patches, []);
    assert.equal(data.unresolvedReasons.onboarding_context_missing, 1);
    assert.equal(data.unresolvedReasons.employee_claim_collision, 1);
    assert.equal(data.unresolvedReasons.employee_uid_conflict, 1);
    assert.equal(data.unresolvedReasons.candidate_not_reciprocal, undefined);
    assert.equal(data.conflicts, 1); assert.equal(data.evidenceMissing, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('proved legacy context links pre-account documents only to reciprocal UID/HR and preserves a frozen null owner', async () => {
  const { projectCensusData } = await import('../../scripts/person-census-core.mjs');
  const { resolve } = await import('node:path');
  const censusRoot = resolve('.ai-work/development-technology/person-traceability-20261103/census');
  mkdirSync(censusRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(censusRoot, 'preaccount-context-witness-'));
  try {
    const baseProcess = { source: 'manual', applicationId: null, jobOpeningId: null, employmentRelationshipType: 'clt', jobRoleId: 'role', functionId: 'function', unitId: 'unit', workspaceId: 'w', integrationV2: { snapshot: { schemaVersion: 'coala-integration-v1' } } };
    const processData = { ...baseProcess, candidateId: 'manual_p', collaboratorUserId: 'u', employeeId: 'u' };
    const context = { database: 'hr', collection: 'onboardingProcesses', id: 'p', data: projectCensusData(processData), contextOnly: true, contextReason: 'manual_person_identity_missing' };
    const contextRows = JSON.stringify(context) + '\n';
    const contextDir = join(dir, 'context'); mkdirSync(contextDir, { mode: 0o700 });
    writeFileSync(join(contextDir, 'census.jsonl'), contextRows, { mode: 0o600 });
    const common = { schema: 1, mode: 'fixture-readonly', projectId: 'demo-person-preaccount', workspace: 'w', sources: [] };
    writeFileSync(join(contextDir, 'manifest.json'), JSON.stringify({ ...common, status: 'incomplete', rows: 1, sha256: createHash('sha256').update(contextRows).digest('hex'), targeted: { rejected: 0, contextOnly: 1 }, gaps: [{ source: 'hr/onboardingProcesses', reason: 'manual_person_identity_missing' }] }), { mode: 0o600 });
    const rows = [
      { database: 'main', collection: 'users', id: 'u', data: { workspaceId: 'w', hrEmployeeId: 'e', source: 'recruitment_onboarding', onboardingId: 'p', recruitmentCandidateId: 'manual_p' } },
      { database: 'hr', collection: 'employees', id: 'e', data: { workspaceId: 'w', auth_uid: 'u', source_user_id: 'u' } },
      { database: 'main', collection: 'generatedDocuments', id: 'pre-account-generated', data: { employeeId: null, onboardingId: 'p' } },
      { database: 'hr', collection: 'hrSignatureRequests', id: 'pre-account-request', data: { onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'explicit-unknown', data: { employeeId: 'unknown-person', onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'explicit-empty', data: { employeeId: '', onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'explicit-invalid', data: { employeeId: ['u'], onboardingId: 'p' } },
      { database: 'main', collection: 'generatedDocuments', id: 'explicit-slash', data: { employeeId: 'bad/id', onboardingId: 'p' } },
      { database: 'hr', collection: 'hrSignatureRequests', id: 'frozen-null-owner', data: { employeeId: null, onboardingId: 'p', subjectKeys: [], 'personBinding.bindingHash': 'a'.repeat(64), 'personBinding.subjectKeys': [] } },
      { database: 'hr', collection: 'onboardingProcesses', id: 'no-user', data: projectCensusData({ ...baseProcess, candidateId: 'manual_no-user' }) },
      { database: 'main', collection: 'generatedDocuments', id: 'no-user-document', data: { onboardingId: 'no-user' } },
      { database: 'hr', collection: 'onboardingProcesses', id: 'divergent', data: projectCensusData({ ...baseProcess, candidateId: 'manual_divergent', collaboratorUserId: 'u', employeeId: 'u' }) },
      { database: 'main', collection: 'generatedDocuments', id: 'divergent-document', data: { onboardingId: 'divergent' } },
      { database: 'hr', collection: 'onboardingProcesses', id: 'company', data: projectCensusData({ source: 'manual', applicationId: null, jobOpeningId: null, employmentRelationshipType: 'pj', employerUnitId: 'unit', providerCnpj: '11444777000161', pjWorkflow: { version: 1, provider: { cnpj: '11444777000161' } } }) },
      { database: 'main', collection: 'generatedDocuments', id: 'company-document', data: { onboardingId: 'company' } },
    ].map((row) => JSON.stringify(row)).join('\n') + '\n';
    const input = join(dir, 'base.jsonl'), manifest = join(dir, 'base-manifest.json');
    writeFileSync(input, rows, { mode: 0o600 }); writeFileSync(manifest, JSON.stringify({ ...common, status: 'incomplete', rows: 15, sha256: createHash('sha256').update(rows).digest('hex'), gaps: [] }), { mode: 0o600 });
    const run = (name: string) => {
      const report = join(dir, name);
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/person-subject-backfill.mjs', '--input', input, '--manifest', manifest, '--context-run', contextDir, '--report', report], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr); return JSON.parse(readFileSync(report, 'utf8'));
    };
    const first = run('first.json'), retry = run('retry.json');
    assert.deepEqual(first.patches, retry.patches); assert.equal(first.patches.length, 2); assert.equal(first.frozenHistory, 1);
    assert.deepEqual(first.patches.map((patch: { id: string }) => patch.id).sort(), ['pre-account-generated', 'pre-account-request']);
    for (const patch of first.patches) {
      assert.deepEqual(patch.add, ['main.users:u', 'hr.employees:e']);
      for (const [collection, id] of [['users', 'u'], ['employees', 'e'], ['onboardingProcesses', 'p']]) assert.ok(patch.guards.some((guard: { collection: string; id: string }) => guard.collection === collection && guard.id === id));
    }
    assert.equal(first.contextGaps.manual_person_identity_missing, 2);
    assert.equal(first.unresolvedReasons.employee_id_unresolved, 1); assert.equal(first.unresolvedReasons.employee_id_invalid, 3);
    assert.ok(first.unresolvedReasons.manual_person_identity_missing >= 1); assert.ok(first.unresolvedReasons.organization_context_not_human_owner >= 1);
    assert.equal(JSON.stringify(first.patches).includes('hr.onboardingPersons:'), false); assert.equal(JSON.stringify(first.patches).includes('hr.candidates:'), false);
    assert.equal(readFileSync(input, 'utf8'), rows); assert.equal(readFileSync(join(contextDir, 'census.jsonl'), 'utf8'), contextRows);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
