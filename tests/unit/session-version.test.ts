import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionVersionsMatch } from '../../src/lib/session-version';

test('sessões legadas sem versão continuam válidas apenas enquanto o cadastro também é zero', () => {
  for (const [token, stored] of [[undefined, undefined], [undefined, 0], [0, undefined], [0, 0], [2, 2]]) {
    assert.equal(sessionVersionsMatch(token, stored), true);
  }
});

test('sessões antigas ou adiantadas não ganham acesso ao cadastro atual', () => {
  for (const [token, stored] of [[undefined, 1], [0, 1], [1, 0], [1, 2], [3, 2]]) {
    assert.equal(sessionVersionsMatch(token, stored), false);
  }
});

test('versões malformadas não são convertidas silenciosamente para zero', () => {
  for (const invalid of [null, '', '0', false, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, {}]) {
    assert.equal(sessionVersionsMatch(invalid, 0), false);
    assert.equal(sessionVersionsMatch(0, invalid), false);
    assert.equal(sessionVersionsMatch(invalid, invalid), false);
  }
});
