import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createNatashaShiftDirectoryApiReader } from '../../scripts/natasha/shift-directory-api-reader';
import { prepareNatashaShiftDirectory } from '../../src/lib/natasha-shift-directory';

function source() {
  return {
    unitIds: ['matriz', 'tirirical'],
    documents: [
      { id: 'global', code: 'G', name: 'Global', startTime: '09:00', endTime: '17:00', daysOfWeek: [5, 1] },
      { id: 'matriz', code: 'M', name: 'Matriz', startTime: '08:00', endTime: '14:00', unitIds: ['matriz'], daysOfWeek: [1, 2, 3] },
      { id: 'fora', code: 'F', name: 'Fora', startTime: '10:00', endTime: '18:00', unitId: 'shopping', daysOfWeek: [1] },
    ],
    sourceQuery: 'synthetic',
  };
}

test('normaliza definições globais e por unidade sem inferir classificação do turno', () => {
  const report = prepareNatashaShiftDirectory(source());
  assert.equal(report.status, 'ready_for_confirmation');
  assert.deepEqual(report.shiftDefinitions.find((item) => item.id === 'global')?.allowedUnitIds, ['matriz', 'tirirical']);
  assert.deepEqual(report.shiftDefinitions.find((item) => item.id === 'global')?.daysOfWeek, [1, 5]);
  assert.deepEqual(report.shiftDefinitions.find((item) => item.id === 'matriz')?.allowedUnitIds, ['matriz']);
  assert.equal(report.shiftDefinitions.some((item) => item.id === 'fora'), false);
  assert.equal(report.evidence.definitionsOutsideScopeOmitted, 1);
  assert.equal(report.evidence.slotClassificationsIncluded, false);
});

test('horário, intervalo ou dias inválidos deixam o catálogo incompleto', () => {
  const input = source();
  input.documents.push({ id: 'quebrado', code: 'Q', name: 'Quebrado', startTime: '17:00', endTime: '09:00', daysOfWeek: [1, 1] });
  const report = prepareNatashaShiftDirectory(input);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((item) => item.code === 'MALFORMED_SHIFT_DEFINITION' && item.shiftDefinitionId === 'quebrado'));
});

test('catálogo vazio não parece pronto para confirmação', () => {
  const input = source();
  input.documents = [];
  const report = prepareNatashaShiftDirectory(input);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.issues.some((item) => item.code === 'NO_SHIFT_DEFINITIONS'));
});

test('leitor da API envia somente unidades e token e valida a resposta', async () => {
  const expected = prepareNatashaShiftDirectory(source());
  let requested = '';
  let authorization = '';
  const reader = createNatashaShiftDirectoryApiReader({
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
  assert.equal(requested, 'https://coala.invalid/api/dp/natasha/shift-definitions?unit=matriz&unit=tirirical');
  assert.equal(authorization, 'Bearer token-sintetico');
});

test('serviço exige escala, unidade autorizada, projeção e sentinela', () => {
  const service = readFileSync('src/features/dp/natasha-shift-directory/service.server.ts', 'utf8');
  const route = readFileSync('src/app/api/dp/natasha/shift-definitions/route.ts', 'utf8');
  assert.match(service, /permissions\.dp\?\.schedules\?\.view/);
  assert.match(service, /canAccessUnit/);
  assert.match(service, /\.select\(\.\.\.PROJECTED_FIELDS\)/);
  assert.match(service, /\.limit\(QUERY_LIMIT\)/);
  assert.match(service, /snapshot\.size === QUERY_LIMIT/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});

test('CLI de definições expõe ajuda sem autenticar ou consultar dados', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/natasha-collect-shift-definitions.mts', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--shift-definition-scope/);
});
