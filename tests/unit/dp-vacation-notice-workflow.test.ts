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

test('aviso usa temporariamente o CNPJ da matriz no fingerprint e no PDF', () => {
  assert.match(server, /const VACATION_NOTICE_COMPANY_CNPJ = '14276603000125'/);
  assert.equal((server.match(/companyCnpj: VACATION_NOTICE_COMPANY_CNPJ/g) ?? []).length, 2);
  assert.match(server, /async function resolveVacationNoticeEmployer\(\)/);
  assert.match(server, /cnpj: VACATION_NOTICE_COMPANY_CNPJ,[\s\S]*fallbackAddress: ''/);
  assert.match(server, /resolveVacationNoticeEmployer\(\),[\s\S]*loadVacationEmployeeDocumentData/);
});

test('rascunho pode ser regenerado antes da validação com auditoria do documento substituído', () => {
  assert.match(server, /\['not_generated', 'failed', 'draft'\]\.includes\(workflow\.notice\.status\)/);
  assert.match(server, /VACATION_NOTICE_REGENERATION_REQUESTED/);
  assert.match(server, /replacedDocumentId/);
  assert.match(server, /replacedStoragePath/);
});

test('envio reconfere o hash e solicita somente a assinatura da colaboradora', () => {
  assert.match(server, /DP_VACATION_NOTICE_SANDBOX_BLOCKED/);
  assert.match(server, /autentiqueSandboxEnabled\(\)/);
  assert.match(server, /actualHash !== prepared\.workflow\.notice\.hashSha256/);
  assert.match(server, /VACATION_NOTICE_TEMPLATE_VERSION = '2\.1'/);
  assert.match(server, /DP_VACATION_NOTICE_TEMPLATE_OUTDATED/);
  assert.match(server, /party: 'employee'/);
  assert.match(server, /x: '39\.0', y: '56\.0', z: 1, element: 'SIGNATURE'/);
  assert.doesNotMatch(server, /party: 'company'/);
  assert.doesNotMatch(server, /resolveCompanyDocumentSignatory/);
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
