import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { middleware } from '../../src/middleware';

const PUBLIC_HOST = 'vagas.coalashakes.com';
const MAIN_HOST = 'op.coalashakes.com';

function publicRequest(pathname: string) {
  return new NextRequest(`https://${PUBLIC_HOST}${pathname}`, {
    headers: { host: PUBLIC_HOST },
  });
}

function mainRequest(pathname: string) {
  return new NextRequest(`https://${MAIN_HOST}${pathname}`, {
    headers: { host: MAIN_HOST },
  });
}

function assertPassThrough(pathname: string) {
  const response = middleware(publicRequest(pathname));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
}

function assertRewrite(pathname: string, destination: string) {
  const response = middleware(publicRequest(pathname));
  assert.equal(response.headers.get('x-middleware-next'), null);
  assert.equal(response.headers.get('x-middleware-rewrite'), `https://${PUBLIC_HOST}${destination}`);
}

test('não interfere no host principal', () => {
  const response = middleware(mainRequest('/dashboard'));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
});

test('mapeia a raiz do host público para a raiz de vagas', () => {
  assertRewrite('/', '/vagas');
});

test('remove o prefixo /vagas da URL pública por redirecionamento', () => {
  const root = middleware(publicRequest('/vagas'));
  assert.equal(root.status, 307);
  assert.equal(root.headers.get('location'), `https://${PUBLIC_HOST}/`);

  const opening = middleware(publicRequest('/vagas/atendente'));
  assert.equal(opening.status, 307);
  assert.equal(opening.headers.get('location'), `https://${PUBLIC_HOST}/atendente`);
});

test('preserva as páginas públicas do ASO no host de vagas', () => {
  const candidate = middleware(publicRequest('/aso/candidato/token-candidato'));
  assert.equal(candidate.headers.get('x-middleware-next'), '1');
  assert.match(candidate.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(candidate.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  const clinic = middleware(publicRequest('/aso/clinica/token-clinica'));
  assert.equal(clinic.headers.get('x-middleware-next'), '1');
  assert.match(clinic.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(clinic.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
});

test('libera somente as APIs públicas necessárias ao fluxo do ASO', () => {
  assertPassThrough('/api/hr/aso/candidate/token-candidato');
  assertPassThrough('/api/hr/aso/clinic/token-clinica');

  const blocked = middleware(publicRequest('/api/hr/onboarding/processo/aso-workflow'));
  assert.equal(blocked.status, 404);
});

test('libera as APIs públicas previstas e bloqueia qualquer outra API', () => {
  for (const pathname of [
    '/api/hr/openings/public',
    '/api/hr/public-stats',
    '/api/hr/recruitment/forms/talent-pool/public',
    '/api/hr/apply',
    '/api/hr/talent',
    '/api/hr/upload',
    '/api/hr/onboarding/public/token-admissao',
    '/api/hr/accountant/token-contador',
  ]) {
    assertPassThrough(pathname);
  }

  for (const pathname of [
    '/api/hr/onboarding/processo',
    '/api/financial/cash-closures',
    '/api/__internal-future-route__',
  ]) {
    assert.equal(middleware(publicRequest(pathname)).status, 404, pathname);
  }
});

test('preserva a página e a API públicas de envio da ficha pelo contador', () => {
  const page = middleware(publicRequest('/contador/ficha-registro/token-contador'));
  assert.equal(page.headers.get('x-middleware-next'), '1');
  assert.match(page.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');

  assertPassThrough('/api/hr/accountant/token-contador');
});

test('mantém íntegro o contrato do link público de admissão enviado por e-mail', () => {
  const page = middleware(publicRequest('/onboarding/token-admissao'));
  assert.equal(page.headers.get('x-middleware-rewrite'), `https://${PUBLIC_HOST}/vagas/onboarding/token-admissao`);

  assertPassThrough('/api/hr/onboarding/public/token-admissao');
  assertPassThrough('/api/hr/upload');
});

test('reescreve slugs de vagas para a árvore pública sem tentar validá-los no middleware', () => {
  assertRewrite('/atendente', '/vagas/atendente');
  assertRewrite('/slug-inexistente', '/vagas/slug-inexistente');
});

test('não serve diretamente rotas internas conhecidas ou futuras no host público', () => {
  assert.equal(middleware(publicRequest('/dashboard')).status, 404);

  // /escala é uma rota interna real fora da denylist. O contrato de isolamento
  // é garantido pelo rewrite para a árvore pública, não por uma lista completa.
  assertRewrite('/escala', '/vagas/escala');
  assertRewrite('/__internal-future-route__', '/vagas/__internal-future-route__');
});

test('preserva assets do Next e arquivos estáticos', () => {
  assertPassThrough('/_next/chunks/app.js');
  assertPassThrough('/icon.png');
  assertPassThrough('/manifest.webmanifest');
});
