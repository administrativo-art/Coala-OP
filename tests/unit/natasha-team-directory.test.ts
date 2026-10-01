import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareNatashaTeamDirectory } from '../../src/lib/natasha-team-directory';
import { createNatashaTeamApiReader } from '../../scripts/natasha/team-api-reader';

function source() {
  const users: Array<Record<string, unknown>> = [
    { id: 'ana', username: 'Ana', isActive: true, unitIds: ['matriz', 'tirirical'], jobRoleId: 'atendente', jobFunctionIds: ['caixa'], shiftDefinitionId: 'turno-a' },
    { id: 'ana', username: 'Ana', isActive: true, unitIds: ['matriz', 'tirirical'] },
    { id: 'bia', username: 'Bia', assignedKioskIds: ['kiosk-t'], jobFunctionIds: ['atendimento'] },
    { id: 'inativa', username: 'Inativa', isActive: false, unitIds: ['matriz'] },
    { id: 'desligada', username: 'Desligada', inactivationType: 'contract_termination', unitIds: ['matriz'] },
  ];
  return {
    unitIds: ['matriz', 'tirirical'],
    units: [{ id: 'matriz' }, { id: 'tirirical', externalId: 'kiosk-t' }],
    users,
    sourceQueries: ['unitIds:matriz', 'unitIds:tirirical', 'assignedKioskIds:tirirical'],
  };
}

test('normaliza equipe ativa, remove duplicatas e limita vínculos ao escopo solicitado', () => {
  const report = prepareNatashaTeamDirectory(source());
  assert.equal(report.status, 'ready_for_confirmation');
  assert.equal(report.employees.length, 2);
  assert.deepEqual(report.employees.find((item) => item.id === 'ana'), {
    id: 'ana', name: 'Ana', active: true, allowedUnitIds: ['matriz', 'tirirical'],
    roleIds: ['atendente', 'caixa'], shiftDefinitionId: 'turno-a',
  });
  assert.deepEqual(report.employees.find((item) => item.id === 'bia')?.allowedUnitIds, ['tirirical']);
  assert.equal(report.evidence.duplicatesRemoved, 1);
  assert.equal(report.evidence.inactiveDocuments, 2);
  assert.equal(report.evidence.requiresHumanConfirmation, true);
});

test('documento malformado ou pessoa sem unidade solicitada deixa a fonte incompleta', () => {
  const input = source();
  input.users.push(
    { id: 'sem-nome', username: '', unitIds: ['matriz'] },
    { id: 'fora', username: 'Fora', unitIds: ['shopping'] },
  );
  const report = prepareNatashaTeamDirectory(input);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((item) => item.code === 'MALFORMED_USER' && item.employeeId === 'sem-nome'));
  assert.ok(report.issues.some((item) => item.code === 'USER_WITHOUT_REQUESTED_UNIT' && item.employeeId === 'fora'));
});

test('mais de 50 pessoas não produz equipe silenciosamente truncada', () => {
  const input = source();
  input.users = Array.from({ length: 51 }, (_, index) => ({
    id: `p-${index}`, username: `Pessoa ${index}`, unitIds: ['matriz'], isActive: true,
  }));
  const report = prepareNatashaTeamDirectory(input);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.employees.length, 50);
  assert.ok(report.issues.some((item) => item.code === 'TEAM_LIMIT_REACHED'));
});

test('equipe sem pessoa ativa exige confirmação em vez de parecer pronta', () => {
  const input = source();
  input.users = [{ id: 'inativa', username: 'Inativa', isActive: false, unitIds: ['matriz'] }];
  const report = prepareNatashaTeamDirectory(input);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((item) => item.code === 'NO_ACTIVE_EMPLOYEES'));
});

test('leitor da API envia somente unidades e token e valida a resposta', async () => {
  let requested = '';
  let authorization = '';
  const expected = prepareNatashaTeamDirectory(source());
  const reader = createNatashaTeamApiReader({
    token: 'token-sintetico',
    baseUrl: 'https://coala.invalid',
    fetcher: async (input, init) => {
      requested = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const report = await reader.collect(['matriz', 'tirirical']);
  assert.equal(report.status, 'ready_for_confirmation');
  assert.equal(requested, 'https://coala.invalid/api/dp/natasha/team?unit=matriz&unit=tirirical');
  assert.equal(authorization, 'Bearer token-sintetico');
});

test('serviço aplica permissão, projeção e sentinela antes de devolver pessoas', () => {
  const service = readFileSync('src/features/dp/natasha-team/service.server.ts', 'utf8');
  const route = readFileSync('src/app/api/dp/natasha/team/route.ts', 'utf8');
  assert.match(service, /permissions\.dp\?\.schedules\?\.view/);
  assert.match(service, /collaborators\?\.view/);
  assert.match(service, /canAccessUnit/);
  assert.match(service, /\.select\(\.\.\.PROJECTED_FIELDS\)/);
  assert.match(service, /\.limit\(QUERY_LIMIT\)/);
  assert.match(service, /snapshot\.size === QUERY_LIMIT/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});

test('CLI de equipe expõe ajuda sem autenticar ou consultar dados', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/natasha-collect-team.mts', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--team-scope/);
});
