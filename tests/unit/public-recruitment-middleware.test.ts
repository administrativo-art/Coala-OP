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

test('preserva a página e a API públicas de envio da ficha pelo contador', () => {
  const page = middleware(publicRequest('/contador/ficha-registro/token-contador'));
  assert.equal(page.headers.get('x-middleware-next'), '1');
  assert.match(page.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');

  assertPassThrough('/api/hr/accountant/token-contador');
});

test('preserva o portal público do recibo de férias', () => {
  const page = middleware(publicRequest('/ferias/contabilidade/token-ferias'));
  assert.equal(page.headers.get('x-middleware-next'), '1');
  assert.match(page.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');

  assertPassThrough('/api/hr/vacation-accountant/token-ferias');
});

test('mantém íntegro o contrato do link público de admissão enviado por e-mail', () => {
  const page = middleware(publicRequest('/onboarding/token-admissao'));
  assert.equal(page.headers.get('x-middleware-rewrite'), `https://${PUBLIC_HOST}/vagas/onboarding/token-admissao`);

  assertPassThrough('/api/hr/onboarding/public/token-admissao');
  assertPassThrough('/api/hr/upload');
});

test('mantém vagas na árvore pública e páginas internas bloqueadas', () => {
  const opening = middleware(publicRequest('/atendente'));
  assert.equal(opening.headers.get('x-middleware-rewrite'), `https://${PUBLIC_HOST}/vagas/atendente`);

  const dashboard = middleware(publicRequest('/dashboard'));
  assert.equal(dashboard.status, 404);
});
