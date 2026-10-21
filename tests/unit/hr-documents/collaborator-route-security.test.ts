import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listRoute = readFileSync('src/app/api/collaborator/documents/route.ts', 'utf8');
const accessRoute = readFileSync('src/app/api/collaborator/documents/access/route.ts', 'utf8');

test('a pasta do colaborador declara titularidade compatível com o enforcer', () => {
  for (const source of [listRoute, accessRoute]) {
    assert.match(source, /authorization: \{ kind: 'owner' \}/);
    assert.match(source, /resourceScope: \{ kind: 'owner' \}/);
    assert.match(source, /'owner-checked'/);
    assert.match(source, /employeeId: actor\.decoded\.uid/);
    assert.doesNotMatch(source, /strategy: 'own-published-documents'/);
  }
});
