import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuthenticatedApiError } from '../../src/lib/authenticated-api-client';
import { employmentPublicationError } from '../../src/features/dp/employment-reference/client';
import { EmploymentReferenceSummary } from '../../src/features/dp/employment-reference/employment-reference-card';
import {
  formatCivilDateBR,
  employerCatalogIssues,
  incompleteDraftFields,
  prepareTimelinePublication,
  previousCivilDate,
  seedEmploymentPeriod,
  type EmploymentHistoryResult,
} from '../../src/features/dp/employment-reference/presentation';
import type { EmploymentPeriod } from '../../src/features/dp/employment-reference/resolve';
import type { User } from '../../src/types';

const user = {
  id: 'person', username: 'Pessoa', email: 'pessoa@example.com', profileId: 'profile', assignedKioskIds: [],
  employmentRelationshipType: 'clt', employerUnitId: 'employer', unitId: 'origin', unitIds: ['origin', 'coverage'],
  jobRoleId: 'role', jobRoleName: 'Atendente', jobFunctionIds: ['function'], jobFunctionNames: ['Atendimento'],
} as User;

const period = (validFrom: string, validTo?: string): EmploymentPeriod => ({
  validFrom, ...(validTo ? { validTo } : {}), employmentRelationshipType: 'clt',
  employerUnitId: 'employer', unitId: 'origin', unitIds: ['origin', 'coverage'],
  jobRoleId: 'role', jobFunctionIds: ['function'], sourceDocumentId: `doc_${validFrom}`,
  sourceReason: 'Contrato conferido pelo DP',
  employer: { unitId: 'employer', unitName: 'Nome operacional', cnpj: '14276603000125', address: 'Rua A', identityStatus: 'catalog_identifiers_consistent_unverified' },
  jobRoleName: 'Atendente', jobFunctionNames: ['Atendimento'],
});

function draft(validFrom: string) {
  return { ...seedEmploymentPeriod(user).draft, validFrom, sourceDocumentId: 'doc_novo', sourceReason: 'Alteração conferida pelo DP' };
}

test('datas visíveis usam padrão brasileiro e o dia anterior respeita mês e ano', () => {
  assert.equal(formatCivilDateBR('2026-10-17'), '17/10/2026');
  assert.equal(previousCivilDate('2026-03-01'), '2026-02-28');
  assert.equal(previousCivilDate('2027-01-01'), '2026-12-31');
  assert.equal(previousCivilDate('2024-03-01'), '2024-02-29');
  const invalid = prepareTimelinePublication({ status: 'missing' }, draft('2026-02-30'));
  assert.equal(invalid.ok, false);
});

test('resumo distingue ausência e inconsistência sem exibir data ISO', () => {
  const missing = renderToStaticMarkup(createElement(EmploymentReferenceSummary, { result: { status: 'missing' }, units: [] }));
  const inconsistent = renderToStaticMarkup(createElement(EmploymentReferenceSummary, { result: { status: 'inconsistent', revision: 2 }, units: [] }));
  assert.match(missing, /Sem histórico/);
  assert.match(inconsistent, /Histórico inconsistente/);
  assert.doesNotMatch(`${missing}${inconsistent}`, /\d{4}-\d{2}-\d{2}/);
});

test('nova vigência preserva períodos, encerra somente o último aberto e remove dados fiscais do body', () => {
  const result: EmploymentHistoryResult = { status: 'found', historyId: 'history', revision: 3, periods: [
    period('2025-01-01', '2025-12-31'), period('2026-01-01'),
  ] };
  const prepared = prepareTimelinePublication(result, draft('2026-11-01'));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.periods.length, 3);
  assert.equal(prepared.periods[0].validTo, '2025-12-31');
  assert.equal(prepared.periods[1].validTo, '2026-10-31');
  assert.equal(prepared.periods[2].validFrom, '2026-11-01');
  assert.equal(prepared.closesPreviousAt, '2026-10-31');
  const serialized = JSON.stringify(prepared.periods);
  assert.doesNotMatch(serialized, /cnpj|address|unitName|jobRoleName|jobFunctionNames|identityStatus/);
});

test('vigência após período encerrado preserva a lacuna existente', () => {
  const result: EmploymentHistoryResult = { status: 'found', historyId: 'history', revision: 1, periods: [period('2026-01-01', '2026-01-31')] };
  const prepared = prepareTimelinePublication(result, draft('2026-02-15'));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.periods[0].validTo, '2026-01-31');
  assert.equal(prepared.closesPreviousAt, null);
});

test('cadastro incompleto bloqueia publicação e não deriva empregador da lotação', () => {
  const incomplete = { ...user, employerUnitId: null, jobRoleId: undefined, jobFunctionIds: undefined } as User;
  const seed = seedEmploymentPeriod(incomplete);
  assert.equal(seed.draft.employerUnitId, '');
  assert.equal(seed.draft.unitId, 'origin');
  assert.ok(incompleteDraftFields({ ...seed.draft, validFrom: '2026-11-01', sourceDocumentId: 'doc_1', sourceReason: 'Contrato conferido' }, incomplete).includes('unidade empregadora'));
  assert.ok(seed.missingFields.includes('cargo'));
  assert.ok(seed.missingFields.includes('funções'));
});

test('publicação aceita referência financeira fora das unidades operacionais', () => {
  const separate = { ...user, unitId: 'finance', unitIds: ['operation'] } as User;
  const seeded = seedEmploymentPeriod(separate).draft;
  const fields = incompleteDraftFields({ ...seeded, validFrom: '2026-11-01', sourceDocumentId: 'doc_1', sourceReason: 'Cadastro conferido pelo DP' }, separate);
  assert.deepEqual(fields, []);
});

test('catálogo bloqueia empregador sem CNPJ válido ou endereço antes do PUT', () => {
  assert.deepEqual(employerCatalogIssues('employer', [{ id: 'employer', name: 'Unidade', cnpj: '123', address: '' } as never]), [
    'CNPJ válido da unidade empregadora', 'endereço da unidade empregadora',
  ]);
  assert.deepEqual(employerCatalogIssues('employer', [{ id: 'employer', name: 'Unidade', cnpj: '14.276.603/0001-25', address: 'Rua A' } as never]), []);
});

test('conflito pede recarga e o componente recarrega após publicação ou ação explícita', () => {
  const error = employmentPublicationError(new AuthenticatedApiError('Conflito', 409, { error: { code: 'DP_EMPLOYMENT_REVISION_CONFLICT' } }));
  assert.equal(error.conflict, true);
  assert.match(error.message, /Atualize as vigências/);
  const source = readFileSync('src/features/dp/employment-reference/employment-reference-card.tsx', 'utf8');
  assert.match(source, /await refresh\(\);/);
  assert.match(source, />Atualizar histórico</);
});
