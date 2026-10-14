import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareNatashaJourneyDirectory } from '../../src/lib/natasha-journey-directory';
import { createNatashaJourneyApiReader } from '../../scripts/natasha/journey-api-reader';

function journey(id = 'company', overrides: Record<string, unknown> = {}) {
  return {
    id,
    lineageId: id,
    version: 1,
    status: 'published' as const,
    name: id,
    weeklyMinutes: 2640,
    cycleLengthDays: 7,
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      plannedMinutes: index === 6 ? 0 : 440,
      isRestDay: index === 6,
    })),
    regime: { mode: 'fixed' as const },
    weeklyRest: { placement: 'schedule' as const, maxConsecutiveWorkDays: 6, sundayCadenceWeeks: 3 },
    scaleValidation: { mode: 'consecutive_days' as const },
    allowedShiftDefinitionIds: ['turno-a'],
    applicability: { scope: { kind: 'company' as const } },
    validFrom: '2026-01-01',
    ...overrides,
  };
}

function source(journeys = [journey()]) {
  return {
    period: '2026-11',
    unitIds: ['matriz'],
    team: {
      status: 'ready_for_confirmation' as const,
      scope: 'active_people_linked_to_requested_units' as const,
      unitIds: ['matriz'],
      employees: [{
        id: 'ana', name: 'Ana', active: true as const, allowedUnitIds: ['matriz'],
        roleIds: ['atendente'], shiftDefinitionId: null,
      }],
      issues: [],
      evidence: {
        sourceQueries: ['unitId:matriz'], returnedDocuments: 1, inactiveDocuments: 0,
        duplicatesRemoved: 0, requiresHumanConfirmation: true as const,
      },
    },
    people: [{
      id: 'ana', name: 'Ana', jobRoleId: 'atendente', jobFunctionIds: ['caixa'], unitId: 'matriz',
      unitGroupId: 'grupo', unitOrganizationId: 'organizacao',
    }],
    journeys,
    sourceQueries: ['users:getAll:1', 'dp_journeys:status:published|archived'],
  };
}

test('resolve a fonte oficial para todos os dias e compacta períodos iguais', () => {
  const report = prepareNatashaJourneyDirectory(source());
  assert.equal(report.status, 'ready_for_proposal');
  assert.equal(report.evidence.resolvedDays, 30);
  assert.equal(report.evidence.requiresHumanJourneyPremise, false);
  assert.deepEqual(report.people[0].assignments.map((assignment) => [assignment.from, assignment.through]), [
    ['2026-11-01', '2026-11-30'],
  ]);
  assert.equal(report.people[0].assignments[0].journey.allowedShiftDefinitionIds[0], 'turno-a');
});

test('aplica precedência do colaborador sobre função, cargo e organização', () => {
  const report = prepareNatashaJourneyDirectory(source([
    journey('organization', { applicability: { scope: { kind: 'unit_organization', id: 'organizacao' } } }),
    journey('role', { applicability: { scope: { kind: 'company' }, jobRoleIds: ['atendente'] } }),
    journey('function', { applicability: { scope: { kind: 'company' }, jobFunctionIds: ['caixa'] } }),
    journey('person', { applicability: { scope: { kind: 'company' }, collaboratorIds: ['ana'] } }),
  ]));
  assert.equal(report.status, 'ready_for_proposal');
  assert.equal(report.people[0].assignments[0].journey.journeyId, 'person');
  assert.equal(report.people[0].assignments[0].journey.resolvedBy, 'collaborator');
});

test('empate e revisão manual bloqueiam a proposta', () => {
  const ambiguous = prepareNatashaJourneyDirectory(source([
    journey('role-a', { applicability: { scope: { kind: 'company' }, jobRoleIds: ['atendente'] } }),
    journey('role-b', { applicability: { scope: { kind: 'company' }, jobRoleIds: ['atendente'] } }),
  ]));
  assert.equal(ambiguous.status, 'incomplete');
  assert.ok(ambiguous.issues.some((issue) => issue.code === 'JOURNEY_AMBIGUOUS'));

  const manual = prepareNatashaJourneyDirectory(source([
    journey('12x36', { scaleValidation: { mode: 'manual_review' } }),
  ]));
  assert.equal(manual.status, 'incomplete');
  assert.ok(manual.issues.some((issue) => issue.code === 'JOURNEY_MANUAL_REVIEW'));
});

test('leitor envia competência, unidades e equipe confirmada, validando a resposta', async () => {
  const expected = prepareNatashaJourneyDirectory(source());
  let requested = '';
  const reader = createNatashaJourneyApiReader({
    token: 'token-sintetico',
    baseUrl: 'https://coala.invalid',
    fetcher: async (input) => {
      requested = String(input);
      return new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const report = await reader.collect('2026-11', ['matriz'], ['ana']);
  assert.equal(report.status, 'ready_for_proposal');
  assert.equal(requested, 'https://coala.invalid/api/dp/natasha/journeys?period=2026-11&unit=matriz&employee=ana');
});

test('serviço usa equipe autorizada, catálogo limitado e rota sem cache', () => {
  const service = readFileSync('src/features/dp/natasha-journeys/service.server.ts', 'utf8');
  const route = readFileSync('src/app/api/dp/natasha/journeys/route.ts', 'utf8');
  assert.match(service, /loadNatashaTeam/);
  assert.match(service, /\.where\('status', 'in', \['published', 'archived'\]\)/);
  assert.match(service, /\.select\(\.\.\.JOURNEY_FIELDS\)/);
  assert.match(service, /\.limit\(JOURNEY_LIMIT \+ 1\)/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});

test('CLI de jornadas expõe ajuda sem autenticar', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/natasha-collect-journeys.mts', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--journey-scope/);
  assert.match(result.stdout, /--employee/);
});
