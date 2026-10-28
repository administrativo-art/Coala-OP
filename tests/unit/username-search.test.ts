import assert from 'node:assert/strict';
import test from 'node:test';

import { usernameSearchVariants } from '../../src/lib/username-search';

test('busca em minúsculas também tenta o nome com inicial maiúscula', () => {
  assert.deepEqual(usernameSearchVariants('fernanda melo'), ['fernanda melo', 'Fernanda melo', 'Fernanda Melo', 'FERNANDA MELO']);
});

test('nunca gera mais de cinco consultas nem prefixo vazio', () => {
  const variants = usernameSearchVariants('  aNa  ');
  assert.ok(variants.length <= 5);
  assert.ok(variants.every(Boolean));
  assert.ok(variants.includes('Ana'));
});
