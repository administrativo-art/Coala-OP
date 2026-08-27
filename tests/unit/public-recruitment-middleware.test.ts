import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { middleware } from '../../src/middleware';

const PUBLIC_HOST = 'vagas.coalashakes.com';

function publicRequest(pathname: string) {
  return new NextRequest(`https://${PUBLIC_HOST}${pathname}`, {
    headers: { host: PUBLIC_HOST },
  });
}

function assertPassThrough(pathname: string) {
  const response = middleware(publicRequest(pathname));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
}

test('preserva as páginas públicas do ASO no host de vagas', () => {
  const candidate = middleware(publicRequest('/aso/candidato/token-candidato'));
  assert.equal(candidate.headers.get('x-middleware-next'), '1');
  assert.match(candidate.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(candidate.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assertPassThrough('/aso/clinica/token-clinica');
});

test('libera somente as APIs públicas necessárias ao fluxo do ASO', () => {
  assertPassThrough('/api/hr/aso/candidate/token-candidato');
  assertPassThrough('/api/hr/aso/clinic/token-clinica');

  const blocked = middleware(publicRequest('/api/hr/onboarding/processo/aso-workflow'));
  assert.equal(blocked.status, 404);
});

test('mantém vagas na árvore pública e páginas internas bloqueadas', () => {
  const opening = middleware(publicRequest('/atendente'));
  assert.equal(opening.headers.get('x-middleware-rewrite'), `https://${PUBLIC_HOST}/vagas/atendente`);

  const dashboard = middleware(publicRequest('/dashboard'));
  assert.equal(dashboard.status, 404);
});
