import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/dp/collaborators/[userId]/employment-reference/route.ts', 'utf8');

test('GET e PUT usam contrato, sem efeito de domínio no enforcer', () => {
  const enforcers = route.slice(route.indexOf('const getEnforcer'), route.indexOf('export const GET'));
  assert.doesNotMatch(enforcers, /await (?:readEmploymentHistory|readEmploymentReference|publishEmploymentReference)\(/);
  assert.match(route, /export const GET = secureRoute\(/);
  assert.match(route, /export const PUT = secureRoute\(/);
  assert.match(route, /const result = await publishEmploymentReference\(security\.actor, security\.input\)/);
  assert.match(route, /status: result\.replayed \? 200 : 201/);
  assert.equal((route.match(/Cache-Control': 'private, no-store'/g) ?? []).length, 2);
});
