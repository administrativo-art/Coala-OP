import assert from 'node:assert/strict';
import test from 'node:test';

import { bindEmploymentReferencePublication, parseEmploymentReferenceQuery,
  publishEmploymentReferenceSchema } from '../../src/features/dp/employment-reference/schemas';
import { resolveEmploymentReference, type EmploymentHistory } from '../../src/features/dp/employment-reference/resolve';

const period = (validFrom: string, validTo?: string) => ({
  validFrom, ...(validTo ? { validTo } : {}), employmentRelationshipType: 'clt',
  employerUnitId: 'employer', unitId: 'origin', unitIds: ['origin', 'coverage'],
  jobFunctionIds: [], sourceDocumentId: 'doc-1', sourceReason: 'Contrato conferido pelo DP',
});
const input = (periods: ReturnType<typeof period>[]) => ({ userId: 'person', expectedRevision: 0, requestId: 'req-1', periods });

test('datas civis inclusivas, lacuna explícita e vigência aberta somente ao fim', () => {
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2026-02-29')])).success, false);
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2024-02-29')])).success, true);
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2026-01-01', '2026-01-31'), period('2026-01-31')])).success, false);
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2026-01-01'), period('2026-02-01')])).success, false);
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2026-01-01', '2026-01-31'), period('2026-02-02')])).success, true);
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([period('2026-01-01', '2026-01-31'), period('2026-01-30')])).success, false);
});

test('resolver não deriva empregador da unidade de cobertura nem preenche lacuna', () => {
  const history = { workspaceId: 'w', userId: 'person', historyId: 'h', revision: 2,
    periods: [
      { ...period('2026-01-01', '2026-01-31'), employer: { unitId: 'employer', cnpj: '14276603000125', unitName: 'Empresa', address: 'Rua', identityStatus: 'catalog_identifiers_consistent_unverified' }, jobRoleName: null, jobFunctionNames: [] },
      { ...period('2026-02-02'), employer: { unitId: 'employer', cnpj: '14276603000125', unitName: 'Empresa', address: 'Rua', identityStatus: 'catalog_identifiers_consistent_unverified' }, jobRoleName: null, jobFunctionNames: [] },
    ],
  } as EmploymentHistory;
  assert.equal(resolveEmploymentReference(null, '2026-02-01').status, 'missing');
  assert.equal(resolveEmploymentReference(history, '2026-02-01').status, 'gap');
  const matched = resolveEmploymentReference(history, '2026-02-02');
  assert.equal(matched.status, 'matched');
  if (matched.status === 'matched') {
    assert.equal(matched.historyId, 'h');
    assert.equal(matched.revision, 2);
    assert.equal(matched.period.employer.cnpj, '14276603000125');
    assert.equal(matched.period.unitIds[1], 'coverage');
  }
  const corrupt = { ...history, periods: [history.periods[1], history.periods[0]] };
  assert.equal(resolveEmploymentReference(corrupt, '2026-02-02').status, 'inconsistent');
  assert.equal(resolveEmploymentReference(history, '2026-02-30').status, 'inconsistent');
  for (const patch of [
    { validFrom: '2026-02-30' }, { unitIds: null }, { jobFunctionIds: [null] },
    { jobFunctionNames: null }, { employer: { ...history.periods[0].employer, identityStatus: 'verified' } },
  ]) {
    const malformed = { ...history, periods: [{ ...history.periods[0], ...patch }] } as unknown as EmploymentHistory;
    assert.equal(resolveEmploymentReference(malformed, '2026-01-01').status, 'inconsistent');
  }
  assert.equal(resolveEmploymentReference(history, '2026-01-31').status, 'matched');
});

test('referência financeira pode ser diferente das unidades operacionais', () => {
  const operationalPeriod = { ...period('2026-01-01'), unitId: 'finance', unitIds: ['operation'] };
  assert.equal(publishEmploymentReferenceSchema.safeParse(input([operationalPeriod])).success, true);
  const history = { workspaceId: 'w', userId: 'person', historyId: 'h', revision: 1,
    periods: [{ ...operationalPeriod, employer: { unitId: 'employer', cnpj: '14276603000125', unitName: 'Empresa', address: 'Rua', identityStatus: 'catalog_identifiers_consistent_unverified' }, jobRoleName: null, jobFunctionNames: [] }],
  } as EmploymentHistory;
  const resolved = resolveEmploymentReference(history, '2026-10-28');
  assert.equal(resolved.status, 'matched');
  if (resolved.status === 'matched') {
    assert.equal(resolved.period.unitId, 'finance');
    assert.deepEqual(resolved.period.unitIds, ['operation']);
  }
});

test('fronteira da API prende pessoa ao path, exige revisão/pedido e rejeita campo fiscal cliente', () => {
  const body = { requestId: 'req-1', expectedRevision: 0, periods: [period('2026-01-01')] };
  assert.equal(bindEmploymentReferencePublication('person', body)?.userId, 'person');
  assert.equal(bindEmploymentReferencePublication('person', { ...body, userId: 'other' }), null);
  assert.equal(bindEmploymentReferencePublication('person', { ...body, requestId: undefined }), null);
  assert.equal(bindEmploymentReferencePublication('person', { ...body, expectedRevision: undefined }), null);
  assert.equal(bindEmploymentReferencePublication('person', { ...body, periods: [{ ...body.periods[0], employerCnpj: '14276603000125' }] }), null);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-01'))?.date, '2026-02-01');
  assert.deepEqual(parseEmploymentReferenceQuery(new URLSearchParams()), {});
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('revision=2'))?.revision, 2);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-01&revision=2'))?.revision, 2);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-30')), null);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-01&revision=0')), null);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-01&date=2026-02-02')), null);
  assert.equal(parseEmploymentReferenceQuery(new URLSearchParams('date=2026-02-01&extra=x')), null);
});
