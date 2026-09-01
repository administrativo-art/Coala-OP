import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync('src/features/hr/vacations/server.ts', 'utf8');
const schema = readFileSync('src/features/hr/vacations/schemas.ts', 'utf8');
const route = readFileSync('src/app/api/dp/vacations/[vacationId]/route.ts', 'utf8');
const webhook = readFileSync('src/app/api/webhooks/autentique/route.ts', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');

test('aviso exige geração, validação e envio em ações separadas', () => {
  assert.match(schema, /generate_notice/);
  assert.match(schema, /validate_notice/);
  assert.match(schema, /send_notice/);
  assert.match(route, /generateVacationNotice/);
  assert.match(route, /validateVacationNotice/);
  assert.match(route, /sendVacationNotice/);
});

test('envio reconfere o hash e posiciona as duas assinaturas no PDF validado', () => {
  assert.match(server, /actualHash !== prepared\.workflow\.notice\.hashSha256/);
  assert.match(server, /x: '16\.0', y: '56\.0', z: 1, element: 'SIGNATURE'/);
  assert.match(server, /x: '62\.0', y: '56\.0', z: 1, element: 'SIGNATURE'/);
  assert.match(server, /Coala Shakes - RH \| Férias/);
});

test('webhook projeta participantes e arquiva o PDF assinado na trilha', () => {
  assert.match(webhook, /syncVacationNoticeSignatureRequest/);
  assert.match(server, /participantsFromRequest/);
  assert.match(server, /signedHashSha256/);
  assert.match(server, /'ready_to_send'/);
});

test('escritas de férias são exclusivas da API autorizada', () => {
  assert.match(rules, /match \/dp_vacations\/\{id\}[\s\S]*?allow create, update, delete: if false;/);
});
