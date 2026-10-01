import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { natashaCoveragePlanSchema } from '../../src/lib/natasha-roster-coverage';
import { natashaProposalInputsSchema } from '../../src/lib/natasha-proposal-preflight';
import { buildNatashaProposalPackage } from '../../src/lib/natasha-proposal-package';
import { natashaRosterSnapshotSchema } from '../../src/lib/natasha-roster-validator';

function fixtures() {
  const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-history-synthetic.json', 'utf8')) as unknown);
  const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-coverage-synthetic.json', 'utf8')) as unknown);
  const inputs = natashaProposalInputsSchema.parse(JSON.parse(readFileSync('tests/fixtures/natasha-proposal-inputs-synthetic.json', 'utf8')) as unknown);
  return { snapshot, plan, inputs };
}

test('empacota alternativas com versão e IDs determinísticos para revisão', () => {
  const { snapshot, plan, inputs } = fixtures();
  const first = buildNatashaProposalPackage(snapshot, plan, inputs);
  const second = buildNatashaProposalPackage(structuredClone(snapshot), structuredClone(plan), structuredClone(inputs));
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 'natasha-proposal/v1');
  assert.equal(first.status, 'ready_for_review');
  assert.match(first.proposalVersion, /^v1-[a-f0-9]{16}$/);
  assert.equal(first.packageId, `natasha:${inputs.period}:${first.proposalVersion}`);
  assert.equal(first.review.status, 'pending');
  assert.equal(first.alternatives[0].review.status, 'pending');
  assert.ok(first.alternatives.every((alternative, index) => alternative.rank === index + 1));
  assert.ok(first.alternatives.every((alternative) => alternative.id.startsWith('alternative:')));
});

test('alterar fonte muda a versão e explicita posições diferentes da melhor', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.employees.push(
    { id: 'ana', active: true, allowedUnitIds: ['matriz'], roleIds: [] },
    { id: 'bia', active: true, allowedUnitIds: ['matriz'], roleIds: [] },
  );
  const day = plan.units[0].days.find((item) => item.date === '2026-10-03')!;
  day.status = 'open';
  day.windows = [{ startTime: '09:00', endTime: '17:00', minimumPeople: 1 }];
  inputs.positions.push({ id: 'm-03', unitId: 'matriz', date: '2026-10-03', startTime: '09:00', endTime: '17:00', slot: 'single', requiredRoleId: null });
  const report = buildNatashaProposalPackage(snapshot, plan, inputs, { minDifferentAssignments: 1 });
  assert.equal(report.alternatives.length, 3);
  assert.equal(report.alternatives[0].changedPositionIds.length, 0);
  assert.ok(report.alternatives.slice(1).some((alternative) => alternative.changedPositionIds.includes('m-03')));
  const changed = structuredClone(inputs);
  changed.employees[0].roleIds = ['extra-confirmed-role'];
  const changedReport = buildNatashaProposalPackage(snapshot, plan, changed, { minDifferentAssignments: 1 });
  assert.notEqual(report.proposalVersion, changedReport.proposalVersion);
  assert.notEqual(report.source.inputHash, changedReport.source.inputHash);
});

test('pacote preserva pendência sem permitir revisão de uma alternativa inexistente', () => {
  const { snapshot, plan, inputs } = fixtures();
  inputs.confirmed.team = false;
  const report = buildNatashaProposalPackage(snapshot, plan, inputs);
  assert.equal(report.status, 'not_ready');
  assert.equal(report.alternatives.length, 0);
  assert.equal(report.review.selectedAlternativeId, null);
});

test('CLI gera somente o pacote sintético e mantém a versão no JSON', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/natasha-package.mts',
    '--snapshot', 'tests/fixtures/natasha-history-synthetic.json',
    '--plan', 'tests/fixtures/natasha-coverage-synthetic.json',
    '--inputs', 'tests/fixtures/natasha-proposal-inputs-synthetic.json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string; proposalVersion: string; alternatives: unknown[] };
  assert.equal(report.status, 'ready_for_review');
  assert.match(report.proposalVersion, /^v1-[a-f0-9]{16}$/);
  assert.equal(report.alternatives.length, 1);
});
