import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createNatashaAvailabilityApiReader } from '../../scripts/natasha/availability-api-reader';
import {
  natashaAvailabilityWindow,
  prepareNatashaAvailability,
} from '../../src/lib/natasha-availability';
import { prepareNatashaTeamDirectory } from '../../src/lib/natasha-team-directory';

function team(statusIssue = false) {
  const users: Array<Record<string, unknown>> = [
    { id: 'edna', username: 'Edna', isActive: true, unitIds: ['shopping'] },
    { id: 'sara', username: 'Sara', isActive: true, unitIds: ['shopping', 'tirirical'] },
  ];
  if (statusIssue) users.push({ id: 'sem-nome', username: '', unitIds: ['shopping'] });
  return prepareNatashaTeamDirectory({
    unitIds: ['shopping', 'tirirical'],
    units: [{ id: 'shopping' }, { id: 'tirirical' }],
    users,
    sourceQueries: ['unitIds:shopping', 'unitIds:tirirical'],
  });
}

function source() {
  return {
    period: '2026-10',
    team: team(),
    vacationDocuments: [
      { id: 'ferias-edna', userId: 'edna', startDate: '2026-10-01', endDate: '2026-10-05', recordType: 'gozo', status: 'APPROVED' },
      { id: 'planejada-sara', userId: 'sara', startDate: '2026-11-10', endDate: '2026-11-14', recordType: 'gozo', status: 'PLANNED' },
      { id: 'venda-edna', userId: 'edna', startDate: '2026-10-20', endDate: '2026-10-24', recordType: 'venda', status: 'APPROVED' },
      { id: 'outra-pessoa', userId: 'fora', startDate: '2026-10-01', endDate: '2026-10-05', recordType: 'gozo', status: 'APPROVED' },
      { id: 'fora-janela', userId: 'sara', startDate: '2026-11-20', endDate: '2026-11-25', recordType: 'gozo', status: 'APPROVED' },
    ],
    sourceQuery: 'dp_vacations:endDate:2026-10-01:2026-12-13',
  };
}

test('prepara férias aprovadas de toda a equipe e separa pendências na janela de continuidade', () => {
  const report = prepareNatashaAvailability(source());
  assert.equal(report.status, 'questions_pending');
  assert.deepEqual(report.window, { from: '2026-10-01', through: '2026-11-14', queryEnd: '2026-12-13' });
  assert.deepEqual(report.approvedVacations.map((item) => item.id), ['ferias-edna']);
  assert.deepEqual(report.unresolvedVacations.map((item) => item.id), ['planejada-sara']);
  assert.ok(report.issues.some((item) => item.code === 'UNRESOLVED_VACATION' && item.employeeId === 'sara'));
  assert.equal(report.evidence.candidateDocumentsExamined, 4);
  assert.equal(report.evidence.outsideCandidateDocumentsOmitted, true);
  assert.equal(report.evidence.ignoredSalesOrRejected, 1);
  assert.equal(report.evidence.externalUnavailabilitiesIncluded, false);
  assert.equal(report.evidence.requiresHumanConfirmation, true);
});

test('fica pronto para confirmação quando só há gozo aprovado e a equipe está íntegra', () => {
  const input = source();
  input.vacationDocuments = input.vacationDocuments.filter((item) => item.id === 'ferias-edna');
  const report = prepareNatashaAvailability(input);
  assert.equal(report.status, 'ready_for_confirmation');
  assert.equal(report.approvedVacations[0]?.employeeName, 'Edna');
});

test('documento malformado ou equipe incompleta falha fechado', () => {
  const malformed = source();
  malformed.vacationDocuments = [{ id: 'quebrada', userId: 'edna', startDate: '2026-10-40', endDate: '2026-10-05', recordType: 'gozo', status: 'APPROVED' }];
  assert.equal(prepareNatashaAvailability(malformed).status, 'incomplete');

  const incomplete = source();
  incomplete.team = team(true);
  incomplete.vacationDocuments = [];
  const report = prepareNatashaAvailability(incomplete);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((item) => item.code === 'TEAM_SOURCE_INCOMPLETE'));
});

test('janela de continuidade atravessa dezembro sem depender do fuso local', () => {
  assert.deepEqual(natashaAvailabilityWindow('2026-12'), {
    from: '2026-12-01', through: '2027-01-14', queryEnd: '2027-02-12',
  });
});

test('leitor da API envia período, unidades e token e valida o contrato', async () => {
  const expectedInput = source();
  expectedInput.vacationDocuments = expectedInput.vacationDocuments.filter((item) => item.id === 'ferias-edna');
  const expected = prepareNatashaAvailability(expectedInput);
  let requested = '';
  let authorization = '';
  const reader = createNatashaAvailabilityApiReader({
    token: 'token-sintetico',
    baseUrl: 'https://coala.invalid',
    fetcher: async (input, init) => {
      requested = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const report = await reader.collect('2026-10', ['shopping', 'tirirical']);
  assert.equal(report.status, 'ready_for_confirmation');
  assert.equal(requested, 'https://coala.invalid/api/dp/natasha/availability?period=2026-10&unit=shopping&unit=tirirical');
  assert.equal(authorization, 'Bearer token-sintetico');
});

test('serviço reutiliza equipe limitada, projeta férias e aplica sentinela', () => {
  const service = readFileSync('src/features/dp/natasha-availability/service.server.ts', 'utf8');
  const route = readFileSync('src/app/api/dp/natasha/availability/route.ts', 'utf8');
  assert.match(service, /loadNatashaTeam/);
  assert.match(service, /team\.status !== 'ready_for_confirmation'/);
  assert.match(service, /\.select\(\.\.\.PROJECTED_FIELDS\)/);
  assert.match(service, /\.limit\(QUERY_LIMIT\)/);
  assert.match(service, /snapshot\.size === QUERY_LIMIT/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});

test('CLI de disponibilidade expõe ajuda sem autenticar ou consultar dados', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/natasha-collect-availability.mts', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--availability-scope/);
});
