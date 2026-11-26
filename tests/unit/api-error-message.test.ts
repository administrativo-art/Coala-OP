import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiErrorMessage } from '../../src/lib/api-error-message';

test('lê o envelope central e o formato antigo; sem mensagem usa o texto padrão', () => {
  assert.equal(apiErrorMessage({ error: { code: 'X', message: 'Sem permissão.' } }, 'padrão'), 'Sem permissão.');
  assert.equal(apiErrorMessage({ error: 'Falha antiga.' }, 'padrão'), 'Falha antiga.');
  for (const payload of [null, undefined, {}, { error: {} }, { error: '  ' }]) assert.equal(apiErrorMessage(payload, 'padrão'), 'padrão');
});
