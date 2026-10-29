import assert from 'node:assert/strict';
import test from 'node:test';
import { contractualDiff } from '../../src/lib/contractual-data';

test('auditoria contratual ignora ordenação e atualização isolada de rótulos', () => {
  assert.deepEqual(contractualDiff({ jobFunctionIds: ['a', 'b'] }, { jobFunctionIds: ['b', 'a'] }), {});
  assert.deepEqual(contractualDiff({ jobRoleName: 'Nome antigo' }, { jobRoleName: 'Nome atualizado no catálogo' }), {});
  assert.deepEqual(contractualDiff({ unitId: 'tirirical' }, { unitId: 'matriz' }), { unitId: { before: 'tirirical', after: 'matriz' } });
});
