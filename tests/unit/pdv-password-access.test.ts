import assert from 'node:assert/strict';
import test from 'node:test';

import { activePdvPasswordAccesses } from '../../src/lib/pdv-password-access';

test('retorna somente acessos ativos e não ressuscita o ID legado quando há lista', () => {
  const accesses = activePdvPasswordAccesses({
    registrationIdPdv: '900',
    pdvAccessFilialId: '1',
    pdvAccesses: [
      { externalUserId: '100', filialId: '1', profileId: '2', status: 'active' },
      { externalUserId: '900', filialId: '1', profileId: '2', status: 'inactive' },
      { externalUserId: 'x', filialId: '1', profileId: '2', status: 'active' },
    ],
  });
  assert.deepEqual(accesses.map((access) => access.externalUserId), ['100']);
});

test('aceita ID legado apenas quando não há lista de acessos e o PDV está habilitado', () => {
  const legacy = { registrationIdPdv: '200', pdvAccessFilialId: '3', pdvAccessProfileId: '4' };
  assert.deepEqual(activePdvPasswordAccesses(legacy).map((access) => access.externalUserId), ['200']);
  assert.deepEqual(activePdvPasswordAccesses({ ...legacy, pdvAccessEnabled: false }), []);
  assert.deepEqual(activePdvPasswordAccesses({ ...legacy, pdvAccesses: [{ externalUserId: '200', filialId: '3', profileId: '4', status: 'inactive' }] }), []);
});
